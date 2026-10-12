import { encodePacked, getAddress, keccak256 } from "viem";
import type { Address } from "./types";

/**
 * Binding code a creator puts in the video description (interfaces.md §1):
 * "cp-" + first 8 hex chars of keccak256(abi.encodePacked(uint256 campaignId, address wallet)).
 * Matches Solidity `bytes4(keccak256(abi.encodePacked(id, wallet)))`.
 */
export function bindingCode(campaignId: bigint, wallet: Address | string): string {
  const hash = keccak256(encodePacked(["uint256", "address"], [campaignId, getAddress(wallet)]));
  return `cp-${hash.slice(2, 10)}`;
}

/** The bytes4 the contract's `bindingCode(id, wallet)` returns, as 0x-prefixed hex. */
export function bindingCodeBytes4(campaignId: bigint, wallet: Address | string): `0x${string}` {
  return `0x${bindingCode(campaignId, wallet).slice(3)}`;
}

/** Case-insensitive check for the binding code anywhere in a description. */
export function containsBindingCode(text: string, campaignId: bigint, wallet: Address | string): boolean {
  return text.toLowerCase().includes(bindingCode(campaignId, wallet));
}
