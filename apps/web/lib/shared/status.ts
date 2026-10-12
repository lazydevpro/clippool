import type { CampaignStatus } from "./api-types";

// ClipPool.sol constants (interfaces.md §5), in seconds.
export const ROOT_DEADLINE = 14 * 86400;
export const CLAIM_PERIOD = 90 * 86400;

/** ClipPool's deploy-time immutables `DISPUTE_WINDOW()` / `MIN_MEASUREMENT_DELAY()`, in seconds. */
export interface ContractWindows {
  disputeWindow: number;
  minMeasurementDelay: number;
}

/**
 * Mainnet values (48h / 1h). The windows are per-deployment (testnet: 10 min / 5 min), so always read them from
 * the deployed contract — these are ONLY a fallback for when the contract can't be read (no address, RPC down,
 * mock mode).
 */
export const FALLBACK_WINDOWS: Readonly<ContractWindows> = Object.freeze({
  disputeWindow: 48 * 3600,
  minMeasurementDelay: 3600,
});

export interface CampaignStatusInput {
  startTime: number;
  endTime: number;
  snapshotTime: number;
  /** unix seconds; null/0 = no root posted (or root cancelled). */
  rootPostedAt: number | null;
  /** unix seconds; defaults to rootPostedAt + disputeWindow. */
  disputeEndsAt?: number | null;
  /** decimal string base units */
  totalAllocated: string | null;
  claimed: string;
  unclaimedSwept: boolean;
  noRootRefunded: boolean;
}

/**
 * Pure mapping of the onchain campaign state + wall clock → CampaignStatus (api-types.ts).
 * @param disputeWindow the contract's DISPUTE_WINDOW() in seconds; used when `disputeEndsAt` is not known.
 */
export function deriveCampaignStatus(c: CampaignStatusInput, now: number, disputeWindow: number): CampaignStatus {
  // refundNoRoot sets unclaimedSwept without a root; the NoRootRefunded event sets noRootRefunded.
  if (c.noRootRefunded || (!c.rootPostedAt && c.unclaimedSwept)) return "refunded";
  if (now < c.startTime) return "upcoming";
  if (now < c.endTime) return "live";
  if (now < c.snapshotTime) return "measuring";
  if (!c.rootPostedAt) return "allocating";
  const disputeEndsAt = c.disputeEndsAt ?? c.rootPostedAt + disputeWindow;
  if (now < disputeEndsAt) return "disputing";
  const total = BigInt(c.totalAllocated ?? "0");
  if (c.unclaimedSwept || total === 0n || BigInt(c.claimed) >= total) return "completed";
  return "paying";
}
