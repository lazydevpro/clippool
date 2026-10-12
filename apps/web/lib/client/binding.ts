import { encodePacked, getAddress, keccak256, type Address } from "viem";

/**
 * Binding code a creator puts in their Short's description (interfaces.md §1):
 * "cp-" + first 8 hex chars of keccak256(abi.encodePacked(uint256 campaignId, address wallet)).
 * Local copy of @clippool/allocation's bindingCode so the client bundle stays free of Node deps.
 */
export function bindingCode(campaignId: bigint | string | number, wallet: Address | string): `cp-${string}` {
  const hash = keccak256(encodePacked(["uint256", "address"], [BigInt(campaignId), getAddress(wallet)]));
  return `cp-${hash.slice(2, 10)}`;
}
