import type { CampaignStatus } from "@/lib/shared/api-types";
import { STATUS_META } from "@/lib/client/status";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  live: "border-success/30 bg-success/12 text-success",
  info: "border-primary/30 bg-primary/12 text-[#2f5e9e] dark:text-brand-soft",
  warning: "border-warning/35 bg-warning/12 text-warning",
  success: "border-success/25 bg-success/10 text-success",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.upcoming;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        TONE[meta.tone],
        className,
      )}
      title={meta.description}
    >
      {meta.tone === "live" ? (
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-success" />
        </span>
      ) : (
        <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

export function TokenBadge({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border bg-background/40 px-2 text-xs font-medium",
        className,
      )}
    >
      <TokenIcon symbol={symbol} />
      {symbol}
    </span>
  );
}

export function TokenIcon({ symbol, className }: { symbol: string; className?: string }) {
  const eur = symbol === "EURC";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold text-white",
        eur ? "bg-[#2b6cb0]" : "bg-[#2775ca]",
        className,
      )}
    >
      {eur ? "€" : "$"}
    </span>
  );
}
