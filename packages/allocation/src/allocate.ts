import { getAddress, isAddress } from "viem";
import { buildTree } from "./tree";
import type {
  Address,
  Allocation,
  AllocationResult,
  AmountsResult,
  CampaignInput,
  Submission,
} from "./types";

export const BPS_DENOMINATOR = 10_000n;
export const MAX_UINT128 = (1n << 128n) - 1n;
export const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export type AllocationParams = Pick<CampaignInput, "pool" | "maxShareBps" | "minViews">;

function validateParams(p: AllocationParams): void {
  if (typeof p.pool !== "bigint" || p.pool < 0n || p.pool > MAX_UINT128) {
    throw new RangeError(`pool must be a bigint in [0, 2^128-1], got ${String(p.pool)}`);
  }
  if (!Number.isInteger(p.maxShareBps) || p.maxShareBps < 0 || p.maxShareBps > 10_000) {
    throw new RangeError(`maxShareBps must be an integer in [0, 10000], got ${p.maxShareBps}`);
  }
  if (typeof p.minViews !== "bigint" || p.minViews < 0n) {
    throw new RangeError(`minViews must be a non-negative bigint, got ${String(p.minViews)}`);
  }
}

/** Normalise a wallet string to its checksummed form; throws on a malformed address. */
export function normalizeWallet(wallet: string): Address {
  if (!isAddress(wallet, { strict: false })) {
    throw new TypeError(`invalid wallet address: ${wallet}`);
  }
  return getAddress(wallet);
}

/** Ascending by lowercase hex address (interfaces.md §2 step 3). */
export function compareWallets(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * interfaces.md §2, steps 1–7, bigint-only floor arithmetic. Pure: no Merkle tree.
 * Deterministic and invariant under permutation of `submissions`.
 */
export function computeAmounts(
  campaign: AllocationParams,
  submissions: readonly Submission[],
): AmountsResult {
  validateParams(campaign);
  const { pool, minViews } = campaign;

  // 1–2. filter by minViews, aggregate score per wallet (compared lowercase)
  const scores = new Map<string, { wallet: Address; score: bigint }>();
  for (const s of submissions) {
    if (typeof s.views !== "bigint" || s.views < 0n) {
      throw new RangeError(`views must be a non-negative bigint (video ${s.videoId})`);
    }
    const wallet = normalizeWallet(s.wallet);
    if (s.views < minViews) continue;
    const key = wallet.toLowerCase();
    const entry = scores.get(key);
    if (entry) entry.score += s.views;
    else scores.set(key, { wallet, score: s.views });
  }

  // 3. sort ascending by lowercase address
  const wallets = [...scores.values()].sort((a, b) => compareWallets(a.wallet, b.wallet));

  // 4. cap (floor)
  const cap = (pool * BigInt(campaign.maxShareBps)) / BPS_DENOMINATOR;

  // 5. water-filling
  let remaining = pool;
  let active = wallets.filter((w) => w.score > 0n);
  const alloc = new Map<string, bigint>();
  for (;;) {
    let S = 0n;
    for (const w of active) S += w.score;
    if (S === 0n) break;
    const tentative = active.map((w) => (remaining * w.score) / S);
    const capped = active.filter((_, i) => tentative[i]! >= cap);
    if (capped.length === 0) {
      active.forEach((w, i) => alloc.set(w.wallet, tentative[i]!));
      break;
    }
    for (const w of capped) {
      alloc.set(w.wallet, cap);
      remaining -= cap;
    }
    const cappedSet = new Set(capped);
    active = active.filter((w) => !cappedSet.has(w));
    if (active.length === 0) break;
  }

  // 6. drop zero allocations (keep sorted order)
  const allocations: Allocation[] = [];
  for (const w of wallets) {
    const amount = alloc.get(w.wallet) ?? 0n;
    if (amount > 0n) allocations.push({ wallet: w.wallet, amount, views: w.score });
  }

  // 7. totals
  let totalAllocated = 0n;
  for (const a of allocations) totalAllocated += a.amount;
  return { allocations, totalAllocated, leftover: pool - totalAllocated };
}

/** Full allocation: amounts + OZ StandardMerkleTree over [campaignId, wallet, amount]. */
export function computeAllocation(
  campaign: CampaignInput,
  submissions: readonly Submission[],
): AllocationResult {
  if (typeof campaign.id !== "bigint" || campaign.id < 0n) {
    throw new RangeError(`campaign id must be a non-negative bigint`);
  }
  const amounts = computeAmounts(campaign, submissions);
  const tree = buildTree(campaign.id, amounts.allocations);
  return { ...amounts, root: tree ? (tree.root as `0x${string}`) : ZERO_ROOT, tree };
}

export interface ShareEstimate extends Allocation {
  /** Percentage of the pool (0–100), for display only. 4-decimal precision. */
  sharePct: number;
}

/**
 * UI convenience: the same algorithm on current (live) views, with a display percentage.
 * Amounts are exact bigints; only `sharePct` is a float.
 */
export function estimateShares(
  campaign: AllocationParams,
  submissions: readonly Submission[],
): { shares: ShareEstimate[]; totalAllocated: bigint; leftover: bigint } {
  const r = computeAmounts(campaign, submissions);
  const shares = r.allocations.map((a) => ({
    ...a,
    sharePct: campaign.pool === 0n ? 0 : Number((a.amount * 1_000_000n) / campaign.pool) / 10_000,
  }));
  return { shares, totalAllocated: r.totalAllocated, leftover: r.leftover };
}
