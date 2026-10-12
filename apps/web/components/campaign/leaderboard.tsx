"use client";

import { Fragment, useState } from "react";
import { ChevronDownIcon, PlayIcon, TrophyIcon } from "lucide-react";
import type { CampaignDetail, LeaderboardEntry, LeaderboardResponse } from "@/lib/shared/api-types";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Address } from "@/components/common/address";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useNow } from "@/hooks/use-now";
import { formatCompact, formatDuration, formatInt, formatPct, formatToken } from "@/lib/client/format";
import { cn } from "@/lib/utils";

const FINAL: CampaignDetail["status"][] = ["disputing", "paying", "completed"];

function Thumb({ url, title }: { url: string | null; title: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="aspect-[9/16] w-12 shrink-0 rounded-md object-cover" loading="lazy" />;
  }
  return (
    <span
      className="flex aspect-[9/16] w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/40 to-brand-soft/20"
      aria-hidden
      title={title}
    >
      <PlayIcon className="size-4 text-white/80" />
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? "bg-[#e9c46a]/20 text-[#e9c46a]" : rank === 2 ? "bg-[#c0c9d6]/20 text-[#c0c9d6]" : rank === 3 ? "bg-[#d4925a]/20 text-[#d4925a]" : "";
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold num",
        medal || "text-muted-foreground",
      )}
    >
      {rank}
    </span>
  );
}

function VideoList({ entry }: { entry: LeaderboardEntry }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {entry.videos.map((v) => (
        <li key={v.videoId}>
          <a
            href={`https://www.youtube.com/shorts/${v.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border bg-background/50 p-2 transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Thumb url={v.thumbnailUrl} title={v.title} />
            <span className="min-w-0">
              <span className="line-clamp-2 text-sm">{v.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground num">{formatInt(v.views)} views</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Leaderboard({
  campaign,
  data,
  isPending,
  error,
  onRetry,
  highlight,
}: {
  campaign: CampaignDetail;
  data: LeaderboardResponse | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  highlight?: string[];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const now = useNow();
  const final = FINAL.includes(campaign.status);
  const mine = new Set((highlight ?? []).map((a) => a.toLowerCase()));

  const toggle = (w: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });

  return (
    <section aria-labelledby="leaderboard-title" className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 id="leaderboard-title" className="flex items-center gap-2 font-semibold">
            <TrophyIcon className="size-4 text-warning" aria-hidden />
            {final ? "Final standings" : "Live leaderboard"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {final
              ? "Views at the snapshot. Payouts are listed on the receipts page."
              : "Estimated payouts at current views. The final split is computed at the snapshot."}
          </p>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground">
            <span className="num">{formatCompact(data.totalViews)}</span> total views
            {now !== null && data.updatedAt > 0 && (
              <>
                {" · "}updated <span className="num">{formatDuration(Math.max(0, now - data.updatedAt))}</span> ago
              </>
            )}
          </p>
        )}
      </div>

      {isPending ? (
        <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading leaderboard">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-5">
          <ErrorState title="Couldn't load the leaderboard" error={error} onRetry={onRetry} />
        </div>
      ) : !data?.entries.length ? (
        <div className="p-5">
          <EmptyState
            icon={<TrophyIcon className="size-5" aria-hidden />}
            title="No Shorts submitted yet"
            description={
              campaign.status === "live"
                ? "Be the first. Early creators get the whole pool to themselves until others join."
                : "Nobody submitted a qualifying Short to this campaign."
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-3 sm:w-12 sm:pl-5">#</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Views</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Share</TableHead>
              <TableHead className="text-right">{final ? "Payout" : "Est. payout"}</TableHead>
              <TableHead className="w-10 pr-3 sm:pr-5">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e, i) => {
              const isOpen = open.has(e.wallet);
              const isMine = mine.has(e.wallet.toLowerCase());
              const below = e.views < campaign.minViews;
              const panelId = `lb-${e.wallet}`;
              return (
                <Fragment key={e.wallet}>
                  <TableRow
                    data-state={isOpen ? "selected" : undefined}
                    className={cn("cursor-pointer", isMine && "bg-primary/8")}
                    onClick={() => toggle(e.wallet)}
                  >
                    <TableCell className="pl-3 sm:pl-5">
                      <RankBadge rank={i + 1} />
                    </TableCell>
                    <TableCell className="max-w-[11rem] sm:max-w-none">
                      <div className="flex flex-col gap-0.5" onClick={(ev) => ev.stopPropagation()}>
                        <span className="flex items-center gap-1.5">
                          <Address address={e.wallet} explorer={false} className="text-foreground" />
                          {isMine && (
                            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
                              You
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {e.channels.map((c) => c.title).join(", ") || "Unknown channel"}
                          <span className="hidden sm:inline">
                            {" · "}
                            <span className="num">{e.videos.length}</span> {e.videos.length === 1 ? "Short" : "Shorts"}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground sm:hidden num">{formatCompact(e.views)} views</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell num">
                      {formatInt(e.views)}
                      {below && <span className="block text-[0.65rem] text-muted-foreground">below min</span>}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell num">
                      {formatPct(e.sharePct)}
                    </TableCell>
                    <TableCell className="text-right font-medium num">
                      {formatToken(e.estimatedAmount)}
                      <span className="hidden text-xs font-normal text-muted-foreground sm:inline"> {campaign.tokenSymbol}</span>
                    </TableCell>
                    <TableCell className="pr-3 sm:pr-5">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        aria-label={isOpen ? "Hide videos" : "Show videos"}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggle(e.wallet);
                        }}
                      >
                        <ChevronDownIcon className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                      </button>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow id={panelId} className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-muted/30 px-5 py-4 whitespace-normal">
                        <VideoList entry={e} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
