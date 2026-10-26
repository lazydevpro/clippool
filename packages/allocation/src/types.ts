import type { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/**
 * Engagement metric used to score submissions.
 * Mirrors the contract's ClipPool.Metric enum (0=Views, 1=Likes, 2=Comments).
 * YouTube API v3 does not expose shareCount, so shares are not supported.
 */
export type EngagementMetric = "views" | "likes" | "comments";

/** One verified YouTube video submitted to a campaign. */
export interface Submission {
  /** 11-char YouTube video id. */
  videoId: string;
  /** 24-char "UC…" channel id. */
  channelId: string;
  /** Payout wallet (any casing; compared lowercase, emitted checksummed). */
  wallet: string;
  /**
   * Score for the selected engagement metric (views, likes, or comments).
   * Historically named `views`; field name kept for backward compatibility.
   * For views campaigns this is the view count; for likes/comments campaigns it
   * is the like count / comment count at snapshot time.
   */
  views: bigint;
}

export interface CampaignInput {
  id: bigint;
  /** Pool in token base units (USDC/EURC: 6 decimals). */
  pool: bigint;
  /** Per-wallet cap in basis points; 10000 = no cap. */
  maxShareBps: number;
  /** Submissions with score < minViews are dropped (threshold applies to all metrics). */
  minViews: bigint;
  /**
   * Engagement metric used to score submissions.
   * Defaults to "views" when omitted for backward compatibility.
   */
  metric?: EngagementMetric;
}

export interface Allocation {
  /** EIP-55 checksummed wallet. */
  wallet: Address;
  amount: bigint;
  /** Aggregated score (Σ views of valid submissions) for this wallet. */
  views: bigint;
}

/** Merkle leaf value: [campaignId, wallet, amount] as decimal strings / checksummed address. */
export type LeafValue = [string, string, string];
export type AllocationTree = StandardMerkleTree<LeafValue>;

export interface AmountsResult {
  /** Sorted ascending by lowercase wallet; wallets with amount 0 are dropped. */
  allocations: Allocation[];
  totalAllocated: bigint;
  leftover: bigint;
}

export interface AllocationResult extends AmountsResult {
  /** Merkle root; bytes32 zero when there are no allocations. */
  root: Hex;
  /** null when there are no allocations (OZ cannot build an empty tree). */
  tree: AllocationTree | null;
}
