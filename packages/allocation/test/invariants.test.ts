import { describe, expect, it } from "vitest";
import { getAddress, keccak256, slice, toBytes } from "viem";
import { computeAllocation, getProof, verifyProof, type CampaignInput, type Submission } from "../src/index";
import { mulberry32 } from "../scripts/fixture-cases";

const CASES = 500;

function randomCase(seed: number): { campaign: CampaignInput; submissions: Submission[]; rand: () => number } {
  const r = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[r() % xs.length]!;
  const big = (max: bigint) => {
    // uniform-ish bigint in [0, max): combine two 32-bit draws
    const x = (BigInt(r()) << 32n) | BigInt(r());
    return max === 0n ? 0n : x % max;
  };

  const nWallets = r() % 20 === 0 ? 0 : 1 + (r() % 25); // mostly 1..25, sometimes 0
  const wallets = Array.from({ length: nWallets }, (_, i) =>
    getAddress(slice(keccak256(toBytes(`inv-${seed}-${i}`)), 12)),
  );
  const nSubs = nWallets === 0 ? r() % 2 : 1 + (r() % 40);
  const viewScale = pick([10n, 1_000n, 1_000_000n, 1_000_000_000_000n]);
  const submissions: Submission[] = [];
  for (let i = 0; i < nSubs; i++) {
    const w = wallets.length ? wallets[r() % wallets.length]! : getAddress(slice(keccak256(toBytes(`x${seed}`)), 12));
    // randomise casing — the algorithm must compare wallets lowercase
    const cased = pick([w, w.toLowerCase(), `0x${w.slice(2).toUpperCase()}`]);
    submissions.push({
      videoId: `v${seed}-${i}`.padEnd(11, "x").slice(0, 11),
      channelId: `UC${String(r() % 5).padEnd(22, "c")}`,
      wallet: cased,
      views: r() % 10 === 0 ? 0n : big(viewScale),
    });
  }
  const pool = r() % 25 === 0 ? 0n : pick([1n, 7n, 100n, 1_000_000_007n, 25_000_000_000n, big(1n << 100n)]);
  const maxShareBps = r() % 25 === 0 ? 0 : pick([1, 500, 1000, 2000, 3333, 5000, 9999, 10000, r() % 10001]);
  const minViews = pick([0n, 1n, viewScale / 100n, viewScale / 10n]);
  return { campaign: { id: BigInt(1 + (r() % 1000)), pool, maxShareBps, minViews }, submissions, rand: r };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = r() % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe(`invariants over ${CASES} random cases`, () => {
  for (let seed = 1; seed <= CASES; seed++) {
    it(`case ${seed}`, () => {
      const { campaign, submissions, rand } = randomCase(seed);
      const res = computeAllocation(campaign, submissions);
      const cap = (campaign.pool * BigInt(campaign.maxShareBps)) / 10_000n;

      // Σ alloc ≤ pool, leftover = pool − Σ
      const sum = res.allocations.reduce((acc, a) => acc + a.amount, 0n);
      expect(sum).toBe(res.totalAllocated);
      expect(sum <= campaign.pool).toBe(true);
      expect(res.leftover).toBe(campaign.pool - sum);

      // every allocation positive and ≤ cap (cap = pool when maxShareBps = 10000)
      for (const a of res.allocations) {
        expect(a.amount > 0n).toBe(true);
        expect(a.amount <= cap).toBe(true);
        expect(a.wallet).toBe(getAddress(a.wallet));
      }

      // strictly ascending by lowercase wallet (sorted + unique)
      const keys = res.allocations.map((a) => a.wallet.toLowerCase());
      for (let i = 1; i < keys.length; i++) expect(keys[i - 1]! < keys[i]!).toBe(true);

      // leftover bound: either everyone positive got the cap, or leftover is just floor dust
      const scored = new Map<string, bigint>();
      for (const s of submissions) {
        if (s.views >= campaign.minViews) {
          const k = s.wallet.toLowerCase();
          scored.set(k, (scored.get(k) ?? 0n) + s.views);
        }
      }
      const W = [...scored.values()].filter((v) => v > 0n).length;
      if (W === 0 || cap === 0n) {
        expect(res.leftover).toBe(campaign.pool);
      } else if (res.allocations.length === W && res.allocations.every((a) => a.amount === cap)) {
        expect(res.leftover).toBe(campaign.pool - BigInt(W) * cap);
      } else {
        expect(res.leftover < BigInt(W)).toBe(true);
      }

      // permutation invariance (order + casing of submissions)
      const permuted = shuffle(submissions, rand).map((s) => ({
        ...s,
        wallet: rand() % 2 ? s.wallet.toLowerCase() : getAddress(s.wallet),
      }));
      const res2 = computeAllocation(campaign, permuted);
      expect(res2.allocations).toEqual(res.allocations);
      expect(res2.root).toBe(res.root);

      // every proof verifies; a tampered amount does not
      for (const a of res.allocations) {
        const proof = getProof(res.tree!, a.wallet)!;
        expect(verifyProof(res.root, campaign.id, a.wallet, a.amount, proof)).toBe(true);
        expect(verifyProof(res.root, campaign.id, a.wallet, a.amount + 1n, proof)).toBe(false);
      }
    });
  }
});
