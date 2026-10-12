"use client";

import { useState } from "react";
import { CheckCircle2Icon, ClockIcon, DownloadIcon, FileJsonIcon, ShieldCheckIcon, TerminalIcon, XCircleIcon } from "lucide-react";
import type { CampaignDetail, ReceiptsResponse } from "@/lib/shared/api-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Address } from "@/components/common/address";
import { Countdown } from "@/components/common/countdown";
import { CopyButton } from "@/components/common/copy-button";
import { TxLink } from "@/components/common/explorer-link";
import { EmptyState, ErrorState } from "@/components/common/states";
import { campaignTitle } from "@/components/campaign/campaign-card";
import { CampaignLoader, PageContainer } from "@/components/campaign/campaign-loader";
import { CampaignBreadcrumb } from "@/components/campaign/campaign-view";
import { StatusBadge } from "@/components/campaign/status-badge";
import { useReceipts } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import { api } from "@/lib/client/api";
import { CLIPPOOL, RPC_FOR_DISPLAY, USE_MOCKS } from "@/lib/client/env";
import { humanizeError } from "@/lib/client/errors";
import { formatDateTime, formatInt, formatToken } from "@/lib/client/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_STYLE = {
  paid: { label: "Paid", icon: CheckCircle2Icon, cls: "text-success bg-success/10 border-success/25" },
  pending: { label: "Pending", icon: ClockIcon, cls: "text-muted-foreground bg-muted border-border" },
  failed: { label: "Failed", icon: XCircleIcon, cls: "text-destructive bg-destructive/10 border-destructive/25" },
} as const;

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1.5 text-lg font-semibold tracking-tight num">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function DisputeBanner({ c, r }: { c: CampaignDetail; r: ReceiptsResponse }) {
  const now = useNow();
  const ends = r.disputeEndsAt ?? c.disputeEndsAt;
  if (!ends) return null;
  const open = now !== null && ends > now;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm",
        open ? "border-warning/30 bg-warning/10" : "border-success/25 bg-success/8",
      )}
    >
      <p className="flex items-center gap-2">
        <ShieldCheckIcon className={cn("size-4", open ? "text-warning" : "text-success")} aria-hidden />
        {open ? (
          <>
            Dispute window open. Payouts start in <Countdown to={ends} className="font-semibold" />.
          </>
        ) : (
          <>Dispute window closed {formatDateTime(ends)}. Payouts are final.</>
        )}
      </p>
      {open && (
        <p className="text-xs text-muted-foreground">
          Spot a problem? The guardian can cancel the root during this window and a corrected split is reposted.
        </p>
      )}
    </div>
  );
}

function VerifySection({ c }: { c: CampaignDetail }) {
  const [downloading, setDownloading] = useState(false);
  const cmd = `pnpm --filter @clippool/allocation verify snapshot.json --rpc ${RPC_FOR_DISPLAY} --address ${CLIPPOOL ?? "<clipPool>"}`;

  const downloadMock = async () => {
    setDownloading(true);
    try {
      const json = await api.getSnapshot(c.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `clippool-${c.id}-snapshot.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section aria-labelledby="verify-title" className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 id="verify-title" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheckIcon className="size-5 text-success" aria-hidden /> Verify this split yourself
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Download the snapshot (submissions, view counts, allocation inputs) and recompute the Merkle root with the
        open-source allocation script. If it matches the root stored onchain, the payouts are exactly what the rules
        produce.
      </p>
      <ol className="mt-5 space-y-4 text-sm">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">1</span>
          <div className="space-y-2">
            <p>Download the published snapshot.</p>
            {USE_MOCKS ? (
              <Button variant="outline" size="sm" onClick={downloadMock} disabled={downloading}>
                <DownloadIcon aria-hidden /> snapshot.json
              </Button>
            ) : (
              <a
                href={api.snapshotUrl(c.id)}
                download={`clippool-${c.id}-snapshot.json`}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
              >
                <DownloadIcon className="size-3.5" aria-hidden /> snapshot.json
              </a>
            )}
            <p className="text-xs text-muted-foreground">
              View data is kept for up to 30 days after the snapshot (YouTube API policy); amounts and the root stay
              onchain forever.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p>Run the verifier from the ClipPool repo.</p>
            <div className="flex items-start gap-2 rounded-xl border bg-background/70 p-3">
              <TerminalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all">{cmd}</code>
              <CopyButton value={cmd} label="Copy command" toastLabel="Command copied" />
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}

function ReceiptsBody({ c }: { c: CampaignDetail }) {
  const q = useReceipts(c.id);
  const r = q.data;
  const allocated = r?.totalAllocated ?? c.totalAllocated;
  const leftover = allocated !== null && allocated !== undefined ? BigInt(c.pool) - BigInt(allocated) : null;
  const paidCount = r?.allocations.filter((a) => a.status === "paid").length ?? 0;
  const paidSum = r?.allocations.filter((a) => a.status === "paid").reduce((s, a) => s + BigInt(a.amount), 0n) ?? 0n;

  return (
    <PageContainer className="space-y-8">
      <CampaignBreadcrumb campaign={c} page="Receipts" />
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Payout receipts</h1>
        <p className="text-muted-foreground">{campaignTitle(c)}</p>
      </header>

      {q.isPending ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading receipts">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState title="Couldn't load receipts" error={q.error} onRetry={() => q.refetch()} />
      ) : !r?.root ? (
        <EmptyState
          icon={<FileJsonIcon className="size-5" aria-hidden />}
          title="No split posted yet"
          description="Receipts appear once the final snapshot is taken and the Merkle root is posted onchain."
        />
      ) : (
        <>
          <DisputeBanner c={c} r={r} />

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Pool" value={formatToken(c.pool, c.tokenSymbol)} />
            <Tile label="Allocated" value={formatToken(allocated, c.tokenSymbol)} sub={`${formatInt(r.allocations.length)} creators`} />
            <Tile
              label="Paid out"
              value={formatToken(paidSum, c.tokenSymbol)}
              sub={`${formatInt(paidCount)} of ${formatInt(r.allocations.length)} transfers`}
            />
            <Tile
              label="Refund to brand"
              value={leftover === null ? "—" : formatToken(leftover, c.tokenSymbol)}
              sub="Cap overflow + rounding"
            />
          </dl>

          <section aria-labelledby="root-title" className="grid gap-3 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-2">
            <h2 id="root-title" className="sr-only">
              Onchain commitments
            </h2>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Merkle root (onchain)</p>
              <p className="mt-1 flex items-center gap-1 font-mono text-xs">
                <span className="truncate" title={r.root}>
                  {r.root}
                </span>
                <CopyButton value={r.root} label="Copy root" toastLabel="Root copied" />
              </p>
            </div>
            {r.snapshotHash && (
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Snapshot hash (onchain)</p>
                <p className="mt-1 flex items-center gap-1 font-mono text-xs">
                  <span className="truncate" title={r.snapshotHash}>
                    {r.snapshotHash}
                  </span>
                  <CopyButton value={r.snapshotHash} label="Copy snapshot hash" toastLabel="Snapshot hash copied" />
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="alloc-title" className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b px-5 py-4">
              <h2 id="alloc-title" className="font-semibold">
                Allocations
              </h2>
              <p className="text-xs text-muted-foreground">Sorted by wallet, as in the Merkle tree</p>
            </div>
            {r.allocations.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No allocations" description="No qualifying submissions; the brand gets a full refund." />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Creator wallet</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5">Transaction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.allocations.map((a) => {
                    const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.pending;
                    return (
                      <TableRow key={a.wallet}>
                        <TableCell className="pl-5">
                          <Address address={a.wallet} />
                        </TableCell>
                        <TableCell className="text-right font-medium num">
                          {formatToken(a.amount)} <span className="text-xs font-normal text-muted-foreground">{c.tokenSymbol}</span>
                        </TableCell>
                        <TableCell>
                          <span className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium", st.cls)}>
                            <st.icon className="size-3" aria-hidden />
                            {st.label}
                          </span>
                        </TableCell>
                        <TableCell className="pr-5">
                          {a.claimTx ? <TxLink hash={a.claimTx} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </section>

          <VerifySection c={c} />
        </>
      )}
    </PageContainer>
  );
}

export function ReceiptsView({ id }: { id: string }) {
  return <CampaignLoader id={id}>{(c) => <ReceiptsBody c={c} />}</CampaignLoader>;
}
