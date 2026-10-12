import { formatUnits } from "viem";
import { TOKEN_DECIMALS } from "@/lib/shared/chain";

const intFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function toBigInt(v: string | bigint | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/**
 * Format a token amount given in base units (6 decimals) as a human string, e.g. "1,234.56 USDC".
 * Pure bigint/string math (no floats); fractional digits are truncated, never rounded up.
 */
export function formatToken(
  amount: string | bigint | number | null | undefined,
  symbol?: string,
  opts: { decimals?: number; compact?: boolean } = {},
): string {
  const { decimals = 2, compact = false } = opts;
  const raw = toBigInt(amount);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const [intPart, fracPart = ""] = formatUnits(abs, TOKEN_DECIMALS).split(".");
  const unit = 10n ** BigInt(TOKEN_DECIMALS);
  let body: string;
  if (compact && abs >= 1_000_000n * unit) {
    body = compactFmt.format(Number(abs / unit));
  } else {
    const frac = fracPart.padEnd(decimals, "0").slice(0, decimals);
    body = intFmt.format(BigInt(intPart)) + (decimals > 0 ? `.${frac}` : "");
    if (abs > 0n && /^0(\.0*)?$/.test(body.replace(/,/g, ""))) {
      body = `<0.${"0".repeat(Math.max(decimals - 1, 0))}1`;
    }
  }
  return `${negative ? "-" : ""}${body}${symbol ? ` ${symbol}` : ""}`;
}

export function formatInt(n: number | bigint | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "0";
  return intFmt.format(typeof n === "string" ? BigInt(n) : n);
}

export function formatCompact(n: number | null | undefined): string {
  return compactFmt.format(n ?? 0);
}

export function formatPct(pct: number, digits = 1): string {
  if (!Number.isFinite(pct)) return "0%";
  if (pct > 0 && pct < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`;
  return `${pct.toFixed(digits)}%`;
}

export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function shortAddress(addr: string | null | undefined, lead = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function shortHash(hash: string | null | undefined): string {
  return shortAddress(hash, 10, 8);
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatDateTime(unixSeconds: number): string {
  return dateFmt.format(new Date(unixSeconds * 1000));
}
export function formatDay(unixSeconds: number): string {
  return dayFmt.format(new Date(unixSeconds * 1000));
}

/** "3d 4h", "4h 12m", "12m 3s", "45s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** "7 days", "48 hours", "5 minutes" (days only from 3 days up, so 24h / 48h read as hours). */
export function formatDelay(seconds: number): string {
  if (seconds % 86400 === 0 && seconds >= 3 * 86400) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return formatDuration(seconds);
}
