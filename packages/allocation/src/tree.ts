import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress } from "viem";
import type { AllocationTree, Hex, LeafValue } from "./types";

/** Leaf encoding shared with Solidity: keccak256(bytes.concat(keccak256(abi.encode(id, account, amount)))). */
export const LEAF_ENCODING = ["uint256", "address", "uint256"] as const;

export function leafValue(campaignId: bigint, wallet: string, amount: bigint): LeafValue {
  return [campaignId.toString(), getAddress(wallet), amount.toString()];
}

/**
 * Build the OZ StandardMerkleTree for a campaign. Returns null for an empty allocation list
 * (OZ cannot build an empty tree; the root convention for that case is bytes32(0)).
 */
export function buildTree(
  campaignId: bigint,
  allocations: readonly { wallet: string; amount: bigint }[],
): AllocationTree | null {
  if (allocations.length === 0) return null;
  const seen = new Set<string>();
  const values = allocations.map((a) => {
    const key = a.wallet.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate wallet in allocations: ${a.wallet}`);
    seen.add(key);
    return leafValue(campaignId, a.wallet, a.amount);
  });
  return StandardMerkleTree.of<LeafValue>(values, [...LEAF_ENCODING]);
}

/** Proof for `wallet` (any casing), or null if the wallet has no leaf. */
export function getProof(tree: AllocationTree, wallet: string): Hex[] | null {
  const key = wallet.toLowerCase();
  for (const [i, v] of tree.entries()) {
    if (v[1].toLowerCase() === key) return tree.getProof(i) as Hex[];
  }
  return null;
}

/** Verify a claim proof against a root exactly as the contract does. */
export function verifyProof(
  root: Hex,
  campaignId: bigint,
  wallet: string,
  amount: bigint,
  proof: readonly Hex[],
): boolean {
  try {
    return StandardMerkleTree.verify<LeafValue>(
      root,
      [...LEAF_ENCODING],
      leafValue(campaignId, wallet, amount),
      [...proof],
    );
  } catch {
    return false;
  }
}
