"use client";

import { useNow } from "@/hooks/use-now";
import { formatDuration } from "@/lib/client/format";
import { cn } from "@/lib/utils";

/** Live "3d 4h" countdown to a unix timestamp. Renders a stable placeholder until hydrated. */
export function Countdown({
  to,
  className,
  pastLabel = "now",
  prefix,
}: {
  to: number;
  className?: string;
  pastLabel?: string;
  prefix?: string;
}) {
  const now = useNow();
  if (now === null) return <span className={cn("num", className)}>—</span>;
  const left = to - now;
  return (
    <span className={cn("num", className)} suppressHydrationWarning>
      {left <= 0 ? pastLabel : `${prefix ? `${prefix} ` : ""}${formatDuration(left)}`}
    </span>
  );
}
