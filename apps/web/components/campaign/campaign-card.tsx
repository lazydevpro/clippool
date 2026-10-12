"use client";

import Link from "next/link";
import { ArrowUpRightIcon, UsersIcon, VideoIcon } from "lucide-react";
import type { CampaignSummary } from "@/lib/shared/api-types";
import { Skeleton } from "@/components/ui/skeleton";
import { Countdown } from "@/components/common/countdown";
import { bpsToPct, formatDay, formatInt, formatToken } from "@/lib/client/format";
import { StatusBadge, TokenIcon } from "./status-badge";

export function campaignTitle(c: Pick<CampaignSummary, "id" | "title">) {
  return c.title?.trim() || `Campaign #${c.id}`;
}

function TimeLine({ c }: { c: CampaignSummary }) {
  switch (c.status) {
    case "upcoming":
      return (
        <>
          Opens in <Countdown to={c.startTime} className="text-foreground" />
        </>
      );
    case "live":
      return (
        <>
          Ends in <Countdown to={c.endTime} className="text-foreground" />
        </>
      );
    case "measuring":
      return (
        <>
          Snapshot in <Countdown to={c.snapshotTime} className="text-foreground" />
        </>
      );
    case "allocating":
      return <>Computing the split</>;
    case "disputing":
      return <>Split published, payout soon</>;
    case "paying":
      return <>Payouts in progress</>;
    case "completed":
      return <>Paid out · ended {formatDay(c.endTime)}</>;
    default:
      return <>Ended {formatDay(c.endTime)}</>;
  }
}

export function CampaignCard({ c }: { c: CampaignSummary }) {
  return (
    <Link
      href={`/c/${c.id}`}
      className="group relative flex flex-col gap-5 rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={c.status} />
        <ArrowUpRightIcon
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
          aria-hidden
        />
      </div>
      <div className="space-y-1.5">
        <h3 className="line-clamp-2 text-base leading-snug font-semibold">{campaignTitle(c)}</h3>
        <p className="text-xs text-muted-foreground">
          Cap {bpsToPct(c.maxShareBps)} per creator · min {formatInt(c.minViews)} views
        </p>
      </div>
      <div>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Pool</p>
        <p className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight num">
          <TokenIcon symbol={c.tokenSymbol} className="size-5 text-[0.7rem]" />
          {formatToken(c.pool)}
          <span className="text-sm font-medium text-muted-foreground">{c.tokenSymbol}</span>
        </p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1" title="Creators">
            <UsersIcon className="size-3.5" aria-hidden />
            <span className="num">{formatInt(c.creatorsCount)}</span>
            <span className="sr-only">creators</span>
          </span>
          <span className="flex items-center gap-1" title="Submitted Shorts">
            <VideoIcon className="size-3.5" aria-hidden />
            <span className="num">{formatInt(c.submissionsCount)}</span>
            <span className="sr-only">Shorts</span>
          </span>
        </span>
        <span className="text-right">
          <TimeLine c={c} />
        </span>
      </div>
    </Link>
  );
}

export function CampaignCardSkeleton() {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-5" aria-hidden>
      <Skeleton className="h-6 w-20 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}
