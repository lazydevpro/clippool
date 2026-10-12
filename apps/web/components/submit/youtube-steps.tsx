"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  ClockIcon,
  EyeIcon,
  GlobeIcon,
  InfoIcon,
  LinkIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCwIcon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react";
import type { Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import type { CampaignDetail, EligibleShort, SubmissionResponse } from "@/lib/shared/api-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Address as AddressChip } from "@/components/common/address";
import { Countdown } from "@/components/common/countdown";
import { ErrorState } from "@/components/common/states";
import { ChannelChips, ConnectYouTubeButton, ScopeNote } from "@/components/youtube/connect-youtube";
import { useEligibleShorts } from "@/hooks/use-youtube";
import { api } from "@/lib/client/api";
import { REJECT_MESSAGES, humanizeError } from "@/lib/client/errors";
import { formatCompact, formatDateTime, formatDay } from "@/lib/client/format";
import { STATUS_META } from "@/lib/client/status";
import { cn } from "@/lib/utils";

function SecondaryLinks({ onUseCode, onPaste }: { onUseCode: () => void; onPaste?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 text-sm sm:flex-row sm:justify-center sm:gap-4">
      {onPaste && (
        <button type="button" className="text-primary hover:underline dark:text-brand-soft" onClick={onPaste}>
          Not listed? Paste a link
        </button>
      )}
      <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={onUseCode}>
        Can&apos;t connect YouTube? Use a binding code instead
      </button>
    </div>
  );
}

export function NotLiveAlert({ campaign, codeHint = false }: { campaign: CampaignDetail; codeHint?: boolean }) {
  if (campaign.status === "live") return null;
  return (
    <Alert>
      <InfoIcon aria-hidden />
      <AlertTitle>Submissions aren&apos;t open</AlertTitle>
      <AlertDescription>
        {campaign.status === "upcoming" ? (
          <>
            This campaign opens in <Countdown to={campaign.startTime} className="font-medium text-foreground" />.
            {codeHint ? " You can add your code to the description now." : " Connect now and come back when it opens."}
          </>
        ) : (
          STATUS_META[campaign.status].description
        )}
      </AlertDescription>
    </Alert>
  );
}

// ── Step 2: Connect YouTube ──
export function ConnectStep({
  wallet,
  onBack,
  onUseCode,
}: {
  wallet: Address;
  onBack: () => void;
  onUseCode: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Connect your YouTube channel</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll list your Shorts that qualify for this campaign. No codes, no editing descriptions.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <ConnectYouTubeButton wallet={wallet} />
        <ScopeNote />
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Payouts for this channel go to <AddressChip address={wallet} className="text-foreground" />
        </p>
      </div>

      <div className="flex flex-col-reverse items-center gap-3 sm:flex-row sm:justify-between">
        <Button variant="ghost" size="lg" className="h-11" onClick={onBack}>
          <ArrowLeftIcon aria-hidden /> Change wallet
        </Button>
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={onUseCode}>
          Can&apos;t connect YouTube? Use a binding code instead
        </button>
      </div>
    </div>
  );
}

function ShortThumb({ short }: { short: EligibleShort }) {
  if (short.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={short.thumbnailUrl} alt="" className="aspect-[9/16] w-16 shrink-0 rounded-lg object-cover" loading="lazy" />;
  }
  return (
    <span
      className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/50 to-brand-soft/20"
      aria-hidden
    >
      <PlayIcon className="size-5 text-white/80" />
    </span>
  );
}

type RowState = { status: "pending" } | { status: "accepted" } | { status: "rejected"; title: string; hint: string };

function rowFromResponse(res: SubmissionResponse): RowState {
  if (res.status === "accepted") return { status: "accepted" };
  const m = res.reason ? REJECT_MESSAGES[res.reason] : null;
  return { status: "rejected", title: m?.title ?? "Submission rejected", hint: res.message ?? m?.hint ?? "This video doesn't meet the campaign rules." };
}

function ShortRow({
  short,
  state,
  live,
  onSubmit,
}: {
  short: EligibleShort;
  state: RowState | undefined;
  live: boolean;
  onSubmit: () => void;
}) {
  const done = short.alreadySubmitted || state?.status === "accepted";
  return (
    <li className={cn("rounded-xl border p-3 transition-colors", done && "border-success/40 bg-success/5")}>
      <div className="flex items-center gap-3">
        <a
          href={`https://www.youtube.com/shorts/${short.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
          aria-label={`Open “${short.title}” on YouTube`}
        >
          <ShortThumb short={short} />
        </a>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium">{short.title || "Untitled Short"}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">{short.channelTitle}</span>
            <span className="inline-flex items-center gap-1 num">
              <EyeIcon className="size-3" aria-hidden /> {formatCompact(short.views)}
            </span>
            <span className="inline-flex items-center gap-1 num">
              <TimerIcon className="size-3" aria-hidden /> {short.durationSec}s
            </span>
            <span className="num">{formatDay(short.publishedAt)}</span>
          </p>
        </div>
        <div className="shrink-0">
          {done ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CircleCheckIcon className="size-4" aria-hidden /> Submitted
            </span>
          ) : (
            <Button size="sm" onClick={onSubmit} disabled={!live || state?.status === "pending"} className="min-w-20">
              {state?.status === "pending" ? <LoaderCircleIcon className="animate-spin" aria-label="Submitting" /> : "Submit"}
            </Button>
          )}
        </div>
      </div>
      {state?.status === "rejected" && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <XCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-medium">{state.title}.</strong> {state.hint}
          </span>
        </p>
      )}
    </li>
  );
}

function EmptyShorts({ campaign, onPaste, onRefresh, refreshing }: { campaign: CampaignDetail; onPaste: () => void; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="space-y-4 rounded-xl border border-dashed p-6">
      <div className="text-center">
        <p className="font-medium">No eligible Shorts yet</p>
        <p className="mt-1 text-sm text-muted-foreground">We checked your 50 most recent uploads. A Short qualifies when it&apos;s:</p>
      </div>
      <ul className="mx-auto max-w-sm space-y-2 text-sm text-muted-foreground">
        <li className="flex gap-2">
          <ClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Published between <span className="num text-foreground">{formatDateTime(campaign.startTime)}</span> and{" "}
            <span className="num text-foreground">{formatDateTime(campaign.endTime)}</span>
          </span>
        </li>
        <li className="flex gap-2">
          <TimerIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>3 minutes or shorter</span>
        </li>
        <li className="flex gap-2">
          <GlobeIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Public (not unlisted or private)</span>
        </li>
      </ul>
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
          <RotateCwIcon className={cn(refreshing && "animate-spin")} aria-hidden /> Check again
        </Button>
        <Button variant="outline" onClick={onPaste}>
          <LinkIcon aria-hidden /> Paste a link instead
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: pick Shorts ──
export function ShortsStep({
  campaign,
  wallet,
  onBack,
  onUseCode,
  onPaste,
  onAccepted,
}: {
  campaign: CampaignDetail;
  wallet: Address;
  onBack: () => void;
  onUseCode: () => void;
  onPaste: () => void;
  onAccepted: () => void;
}) {
  const qc = useQueryClient();
  const q = useEligibleShorts(campaign.id, wallet);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);
  const live = campaign.status === "live";
  const accepted = Object.values(rows).filter((r) => r.status === "accepted").length;

  const submitOne = async (videoId: string) => {
    setError(null);
    setRows((r) => ({ ...r, [videoId]: { status: "pending" } }));
    try {
      const res = await api.submit({ campaignId: campaign.id, videoUrl: `https://www.youtube.com/shorts/${videoId}`, wallet });
      setRows((r) => ({ ...r, [videoId]: rowFromResponse(res) }));
      if (res.status === "accepted") {
        onAccepted();
        void qc.invalidateQueries({ queryKey: ["leaderboard", campaign.id] });
      }
    } catch (err) {
      setRows((r) => {
        const next = { ...r };
        delete next[videoId];
        return next;
      });
      setError(humanizeError(err));
    }
  };

  const open = (q.data?.shorts ?? []).filter((s) => !s.alreadySubmitted && rows[s.videoId]?.status !== "accepted");
  const submitAll = async () => {
    for (const s of open) {
      if (rows[s.videoId]?.status === "pending") continue;
      await submitOne(s.videoId);
    }
  };
  const anyPending = Object.values(rows).some((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Pick the Shorts to submit</h2>
          <p className="mt-1 text-sm text-muted-foreground">Only Shorts that fit this campaign&apos;s rules are listed.</p>
        </div>
        {open.length > 1 && live && (
          <Button variant="outline" onClick={() => void submitAll()} disabled={anyPending} className="shrink-0">
            Submit all ({open.length})
          </Button>
        )}
      </div>

      {q.data && q.data.channels.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <ChannelChips channels={q.data.channels} />
          <ConnectYouTubeButton wallet={wallet} variant="another" />
        </div>
      )}

      <NotLiveAlert campaign={campaign} />

      {accepted > 0 && (
        <Alert className="border-success/40 bg-success/5" aria-live="polite">
          <CircleCheckIcon className="text-success" aria-hidden />
          <AlertTitle>You&apos;re in!</AlertTitle>
          <AlertDescription>
            <span>
              {accepted === 1 ? "Your Short is" : `${accepted} Shorts are`} part of the pool. Views keep counting until the snapshot,
              and your payout is sent to <AddressChip address={wallet} className="text-foreground" /> automatically.
            </span>
            <div className="mt-2">
              <Link href={`/c/${campaign.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                See the leaderboard <ArrowRightIcon aria-hidden />
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {q.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your Shorts">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[7.5rem] rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState title="Couldn't load your Shorts" error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.shorts.length === 0 ? (
        <EmptyShorts campaign={campaign} onPaste={onPaste} onRefresh={() => q.refetch()} refreshing={q.isFetching} />
      ) : (
        <ul className="space-y-3">
          {q.data.shorts.map((s) => (
            <ShortRow key={s.videoId} short={s} state={rows[s.videoId]} live={live} onSubmit={() => void submitOne(s.videoId)} />
          ))}
        </ul>
      )}

      {error && (
        <Alert variant="destructive">
          <XCircleIcon aria-hidden />
          <AlertTitle>Couldn&apos;t submit</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4 border-t pt-4">
        <SecondaryLinks onUseCode={onUseCode} onPaste={q.data?.shorts.length ? onPaste : undefined} />
        <Button variant="ghost" size="lg" className="h-11" onClick={onBack}>
          <ArrowLeftIcon aria-hidden /> Change wallet
        </Button>
      </div>
    </div>
  );
}
