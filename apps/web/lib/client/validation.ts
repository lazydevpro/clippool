import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { formatDelay } from "./format";

export function validateWallet(raw: string): { address?: Address; error?: string } {
  const v = raw.trim();
  if (!v) return { error: "Enter the wallet address that should receive your payout." };
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return { error: "That isn't an EVM address. It should start with 0x and have 40 hex characters." };
  if (!isAddress(v, { strict: false })) return { error: "That isn't a valid address." };
  // Mixed-case input must carry a valid EIP-55 checksum (catches typos).
  if (v !== v.toLowerCase() && v.slice(2) !== v.slice(2).toUpperCase() && !isAddress(v, { strict: true })) {
    return { error: "Checksum mismatch. One of the characters looks mistyped; copy the address again from your wallet." };
  }
  const address = getAddress(v);
  if (address === zeroAddress) return { error: "The zero address can't receive payouts." };
  return { address };
}

export function looksLikeShortsUrl(url: string) {
  return /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(shorts\/|watch\?v=)|youtu\.be\/)[A-Za-z0-9_-]{11}/.test(url.trim());
}

export interface DelayPreset {
  value: string; // seconds
  label: string;
  hint: string;
}

const DELAY_PRESETS: DelayPreset[] = [
  { value: "3600", label: "1 hour", hint: "Fast demo" },
  { value: "86400", label: "24 hours", hint: "Short campaigns" },
  { value: "604800", label: "7 days", hint: "Recommended" },
];

/**
 * Measurement-delay presets allowed by the contract's MIN_MEASUREMENT_DELAY() (seconds). Where the minimum is
 * below 1 hour (testnet deployments: 5 min) a fast "5 minutes (testnet)" option is offered first.
 */
export function delayPresets(minDelay: number): DelayPreset[] {
  const allowed = DELAY_PRESETS.filter((d) => Number(d.value) >= minDelay);
  if (minDelay >= 3600) return allowed;
  const fast = Math.max(300, minDelay);
  return [{ value: String(fast), label: `${formatDelay(fast)} (testnet)`, hint: "Fast end-to-end test" }, ...allowed];
}
