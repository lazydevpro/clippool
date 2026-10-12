import type { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** One verified YouTube video submitted to a campaign. */
export interface Submission {
  /** 11-char YouTube video id. */
  videoId: string;
  /** 24-char "UC…" channel id. */
  channelId: string;
  /** Payout wallet (any casing; compared lowercase, emitted checksummed). */
  wallet: string;
  /** View count at snapshot time. */
  views: bigint;
}

export interface CampaignInput {
  id: bigint;
  /** Pool in token base units (USDC/EURC: 6 decimals). */
  pool: bigint;
  /** Per-wallet cap in basis points; 10000 = no cap. */
  maxShareBps: number;
  /** Submissions with views < minViews are dropped. */
  minViews: bigint;
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
