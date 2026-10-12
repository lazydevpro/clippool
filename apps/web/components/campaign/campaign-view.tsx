"use client";

import Link from "next/link";
import { ArrowRightIcon, FileTextIcon, ReceiptIcon, ShieldCheckIcon, UploadIcon } from "lucide-react";
import { useConnection } from "wagmi";
import type { CampaignDetail } from "@/lib/shared/api-types";
import { buttonVariants } from "@/components/ui/button";
import { Address } from "@/components/common/address";
import { Countdown } from "@/components/common/countdown";
import { CopyButton } from "@/components/common/copy-button";
import { TxLink } from "@/components/common/explorer-link";
import { useLeaderboard } from "@/hooks/use-api";
import { useCircleSession } from "@/hooks/use-circle-session";
import { bpsToPct, formatCompact, formatDelay, formatInt, formatToken, shortHash } from "@/lib/client/format";
import { ACCEPTS_SUBMISSIONS, HAS_RECEIPTS, STATUS_META } from "@/lib/client/status";
import { cn } from "@/lib/utils";
import { campaignTitle } from "./campaign-card";
import { CampaignLoader, PageContainer } from "./campaign-loader";
import { Leaderboard } from "./leaderboard";
import { StatusBadge, TokenBadge, TokenIcon } from "./status-badge";
import { CampaignTimeline } from "./timeline";

function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1.5 text-lg font-semibold tracking-tight sm:text-xl num">{children}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

export function CampaignBreadcrumb({ campaign, page }: { campaign: CampaignDetail; page?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/#campaigns" className="hover:text-foreground">
            Campaigns
          </Link>
        </li>
        <li aria-hidden>/</li>
        <li>
          {page ? (
            <Link href={`/c/${campaign.id}`} className="hover:text-foreground">
              #{campaign.id}
            </Link>
          ) : (
            <span aria-current="page">#{campaign.id}</span>
          )}
        </li>
        {page && (
          <>
            <li aria-hidden>/</li>
            <li aria-current="page">{page}</li>
          </>
        )}
      </ol>
    </nav>
  );
}

function ActionCard({ c }: { c: CampaignDetail }) {
  const live = ACCEPTS_SUBMISSIONS.includes(c.status);
  const receipts = HAS_RECEIPTS.includes(c.status);
  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border bg-card p-5 lg:w-80">
      {c.status === "upcoming" && (
        <>
          <p className="text-sm text-muted-foreground">
            Submissions open in <Countdown to={c.startTime} className="font-medium text-foreground" />.
          </p>
          <Link href={`/c/${c.id}/submit`} className={buttonVariants({ size: "lg", className: "h-11" })}>
            <UploadIcon aria-hidden /> Get your binding code
          </Link>
        </>
      )}
      {live && (
        <>
          <p className="text-sm text-muted-foreground">
            Closes in <Countdown to={c.endTime} className="font-medium text-foreground" />. No gas, no signup.
          </p>
          <Link href={`/c/${c.id}/submit`} className={buttonVariants({ size: "lg", className: "h-11" })}>
            <UploadIcon aria-hidden /> Submit your Short
          </Link>
        </>
      )}
      {(c.status === "measuring" || c.status === "allocating") && (
        <p className="text-sm text-muted-foreground">
          {c.status === "measuring" ? (
            <>
              Submissions are closed. Final view snapshot in{" "}
              <Countdown to={c.snapshotTime} className="font-medium text-foreground" />.
            </>
          ) : (
            "The snapshot is in. The split is being computed and will be posted onchain shortly."
          )}
        </p>
      )}
      {receipts && (
        <>
          <p className="text-sm text-muted-foreground">
            {c.status === "disputing" && c.disputeEndsAt ? (
              <>
                Split posted onchain. Payouts start in{" "}
                <Countdown to={c.disputeEndsAt} className="font-medium text-foreground" />.
              </>
            ) : c.status === "paying" ? (
              <>
                <span className="font-medium text-foreground num">{formatToken(c.claimed, c.tokenSymbol)}</span> paid so
                far.
              </>
            ) : (
              "Every allocation has been paid onchain."
            )}
          </p>
          <Link href={`/c/${c.id}/receipts`} className={buttonVariants({ size: "lg", className: "h-11" })}>
            <ReceiptIcon aria-hidden /> View payout receipts
          </Link>
        </>
      )}
      {c.status === "refunded" && (
        <p className="text-sm text-muted-foreground">No split was posted in time, so the pool was returned to the brand.</p>
      )}
    </div>
  );
}

function CampaignBody({ c }: { c: CampaignDetail }) {
  const lb = useLeaderboard(c.id);
  const { address } = useConnection();
  const circle = useCircleSession();
  const highlight = [address, circle?.address].filter(Boolean) as string[];
  const totalViews = lb.data?.totalViews;

  return (
    <PageContainer className="space-y-8">
      <CampaignBreadcrumb campaign={c} />

      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            <TokenBadge symbol={c.tokenSymbol} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{campaignTitle(c)}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>Funded by</span>
            <Address address={c.brand} className="text-foreground" />
            {c.createTx && (
              <>
                <span aria-hidden>·</span>
                <TxLink hash={c.createTx} label="creation tx" />
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">{STATUS_META[c.status].description}</p>
        </div>
        <ActionCard c={c} />
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pool" sub={c.tokenSymbol === "EURC" ? "Euro stablecoin" : "US dollar stablecoin"}>
          <span className="flex items-center gap-2">
            <TokenIcon symbol={c.tokenSymbol} className="size-5" />
            {formatToken(c.pool)} <span className="text-sm font-medium text-muted-foreground">{c.tokenSymbol}</span>
          </span>
        </Stat>
        <Stat label="Creators" sub={`${formatInt(c.submissionsCount)} Shorts submitted`}>
          {formatInt(c.creatorsCount)}
        </Stat>
        <Stat label="Total views" sub="Across qualifying Shorts">
          {totalViews === undefined ? "—" : formatCompact(totalViews)}
        </Stat>
        <Stat label="Per-creator cap" sub={`max ${formatToken((BigInt(c.pool) * BigInt(c.maxShareBps)) / 10000n, c.tokenSymbol)}`}>
          {bpsToPct(c.maxShareBps)}
        </Stat>
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Leaderboard
            campaign={c}
            data={lb.data}
            isPending={lb.isPending}
            error={lb.isError ? lb.error : null}
            onRetry={() => lb.refetch()}
            highlight={highlight}
          />
        </div>
        <aside className="space-y-6">
          <CampaignTimeline campaign={c} />

          <section aria-labelledby="rules-title" className="rounded-2xl border bg-card p-5">
            <h2 id="rules-title" className="flex items-center gap-2 font-semibold">
              <FileTextIcon className="size-4 text-muted-foreground" aria-hidden /> Rules
            </h2>
            {c.rules ? (
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{c.rules}</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">The brand hasn&apos;t published the rules text yet.</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
              <div>
                <dt className="text-muted-foreground">Minimum views</dt>
                <dd className="mt-0.5 font-medium num">{formatInt(c.minViews)} per Short</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Measurement delay</dt>
                <dd className="mt-0.5 font-medium">{formatDelay(c.snapshotTime - c.endTime)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
              <span className="min-w-0">
                Rules hash stored onchain:{" "}
                <span className="font-mono text-foreground" title={c.rulesHash}>
                  {shortHash(c.rulesHash)}
                </span>
                <CopyButton value={c.rulesHash} label="Copy rules hash" toastLabel="Rules hash copied" className="-my-1" />
              </span>
            </div>
          </section>

          {ACCEPTS_SUBMISSIONS.includes(c.status) && (
            <Link
              href={`/c/${c.id}/submit`}
              className={cn(
                "group flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 p-5 transition-colors hover:bg-primary/15",
              )}
            >
              <span>
                <span className="block font-medium">Ready to earn?</span>
                <span className="text-sm text-muted-foreground">Get your code and submit in under a minute.</span>
              </span>
              <ArrowRightIcon className="size-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}

export function CampaignView({ id }: { id: string }) {
  return <CampaignLoader id={id}>{(c) => <CampaignBody c={c} />}</CampaignLoader>;
}
