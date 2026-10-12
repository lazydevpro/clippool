"use client";

import type { CampaignDetail } from "@/lib/shared/api-types";
import { Countdown } from "@/components/common/countdown";
import { useNow } from "@/hooks/use-now";
import { formatDateTime, formatDelay } from "@/lib/client/format";
import { cn } from "@/lib/utils";

interface Milestone {
  label: string;
  at: number | null;
  hint?: string;
  done: boolean;
}

function milestones(c: CampaignDetail, now: number | null): Milestone[] {
  const t = now ?? 0;
  const rootPosted = ["disputing", "paying", "completed"].includes(c.status);
  const paid = c.status === "completed";
  return [
    { label: "Submissions open", at: c.startTime, done: t >= c.startTime },
    { label: "Submissions close", at: c.endTime, done: t >= c.endTime },
    { label: "View snapshot", at: c.snapshotTime, done: t >= c.snapshotTime },
    {
      label: "Dispute window ends",
      at: c.disputeEndsAt,
      hint: c.disputeEndsAt ? undefined : `${formatDelay(c.disputeWindow)} after the split is posted`,
      done: rootPosted && c.disputeEndsAt !== null && t >= c.disputeEndsAt,
    },
    {
      label: c.status === "refunded" ? "Refunded to brand" : "Payouts pushed",
      at: null,
      hint: paid ? "All allocations paid" : c.status === "paying" ? "In progress" : "Automatic, no claiming",
      done: paid || c.status === "refunded",
    },
  ];
}

export function CampaignTimeline({ campaign }: { campaign: CampaignDetail }) {
  const now = useNow();
  const items = milestones(campaign, now);
  const nextIdx = items.findIndex((m) => !m.done);
  return (
    <section aria-labelledby="timeline-title" className="rounded-2xl border bg-card p-5">
      <h2 id="timeline-title" className="font-semibold">
        Timeline
      </h2>
      <ol className="mt-4 space-y-0">
        {items.map((m, i) => {
          const active = i === nextIdx;
          return (
            <li key={m.label} className="relative flex gap-3 pb-5 last:pb-0">
              {i < items.length - 1 && (
                <span
                  className={cn("absolute top-4 left-[7px] h-full w-px", m.done ? "bg-primary" : "bg-border")}
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  "relative mt-1 size-[15px] shrink-0 rounded-full border-2",
                  m.done && "border-primary bg-primary",
                  active && "border-primary bg-background ring-4 ring-primary/20",
                  !m.done && !active && "border-border bg-background",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", m.done || active ? "text-foreground" : "text-muted-foreground")}>
                  {m.label}
                  <span className="sr-only">{m.done ? " (done)" : active ? " (next)" : ""}</span>
                </p>
                <p className="text-xs text-muted-foreground num">
                  {m.at ? formatDateTime(m.at) : m.hint}
                  {active && m.at && now !== null && m.at > now && (
                    <>
                      {" · "}
                      <Countdown to={m.at} prefix="in" className="font-medium text-foreground" />
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {campaign.disputeEndsAt === null && (
        <p className="mt-4 text-xs text-muted-foreground">
          The dispute window lasts {formatDelay(campaign.disputeWindow)} after the split is posted onchain.
        </p>
      )}
    </section>
  );
}
