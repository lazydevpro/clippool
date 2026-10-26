"use client";

import { useState } from "react";
import { CheckIcon, MessageSquareIcon, ThumbsDownIcon, ThumbsUpIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Address } from "viem";
import type { CampaignDetail, SubmissionForReview } from "@/lib/shared/api-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useCampaignSubmissions } from "@/hooks/use-api";
import { api } from "@/lib/client/api";
import { formatInt } from "@/lib/client/format";
import { cn } from "@/lib/utils";

function ReviewBadge({ review }: { review: "approved" | "rejected" | null }) {
  if (review === "approved") return <Badge variant="outline" className="border-success/50 bg-success/10 text-success gap-1"><CheckIcon className="size-3" />Approved</Badge>;
  if (review === "rejected") return <Badge variant="outline" className="border-destructive/50 bg-destructive/10 text-destructive gap-1"><XIcon className="size-3" />Rejected</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
}

function SubmissionCard({
  sub,
  campaignId,
  brandWallet,
  onReviewed,
}: {
  sub: SubmissionForReview;
  campaignId: string;
  brandWallet: Address;
  onReviewed: () => void;
}) {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);

  const decide = async (decision: "approved" | "rejected") => {
    setLoading(decision === "approved" ? "approve" : "reject");
    try {
      await api.reviewSubmission(campaignId, sub.id, { decision }, brandWallet);
      toast.success(decision === "approved" ? "Submission approved" : "Submission rejected");
      onReviewed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setLoading(null);
    }
  };

  const metricValue = sub.views !== null ? sub.views : null;

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start", sub.brandReview === "rejected" && "opacity-60")}>
      {/* thumbnail */}
      {sub.thumbnailUrl ? (
        <a href={`https://www.youtube.com/shorts/${sub.videoId}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <img src={sub.thumbnailUrl} alt={sub.title} className="h-20 w-36 rounded-lg object-cover" />
        </a>
      ) : (
        <div className="h-20 w-36 shrink-0 rounded-lg bg-muted" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <a
              href={`https://www.youtube.com/shorts/${sub.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-2 text-sm font-medium hover:underline"
            >
              {sub.title}
            </a>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{sub.channelTitle}</p>
          </div>
          <ReviewBadge review={sub.brandReview} />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {metricValue !== null && (
            <span className="flex items-center gap-1 num">
              {sub.views !== null && <><span>{formatInt(sub.views)}</span> views</>}
            </span>
          )}
          {sub.likes !== null && (
            <span className="flex items-center gap-1 num">{formatInt(sub.likes)} likes</span>
          )}
          {sub.comments !== null && (
            <span className="flex items-center gap-1 num">
              <MessageSquareIcon className="size-3" />{formatInt(sub.comments)}
            </span>
          )}
          <span className="font-mono truncate max-w-[12rem]">{sub.wallet.slice(0, 10)}…</span>
        </div>

        {sub.brandReviewNote && (
          <p className="text-xs text-muted-foreground italic">&ldquo;{sub.brandReviewNote}&rdquo;</p>
        )}

        {sub.brandReview === null && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-success/50 text-success hover:bg-success/10"
              disabled={loading !== null}
              onClick={() => decide("approved")}
            >
              {loading === "approve" ? <span className="animate-spin">⟳</span> : <ThumbsUpIcon className="size-3.5" />}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={loading !== null}
              onClick={() => decide("rejected")}
            >
              {loading === "reject" ? <span className="animate-spin">⟳</span> : <ThumbsDownIcon className="size-3.5" />}
              Reject
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SubmissionReviewPanel({ campaign, brandWallet }: { campaign: CampaignDetail; brandWallet: Address }) {
  const q = useCampaignSubmissions(campaign.id, brandWallet);
  const subs = q.data?.submissions ?? [];
  const pending = subs.filter((s) => s.brandReview === null);
  const reviewed = subs.filter((s) => s.brandReview !== null);

  return (
    <section aria-labelledby="review-title" className="rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 id="review-title" className="font-semibold">Submission review</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pending.length > 0 ? `${pending.length} pending review` : "All submissions reviewed"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          Refresh
        </Button>
      </div>

      <div className="p-5 space-y-4">
        {q.isPending ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : q.isError ? (
          <ErrorState title="Couldn't load submissions" error={q.error} onRetry={() => q.refetch()} />
        ) : subs.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-5" aria-hidden />}
            title="No submissions yet"
            description="Submissions will appear here once creators submit their Shorts."
          />
        ) : (
          <>
            {pending.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Awaiting review ({pending.length})</p>
                {pending.map((s) => (
                  <SubmissionCard key={s.id} sub={s} campaignId={campaign.id} brandWallet={brandWallet} onReviewed={() => q.refetch()} />
                ))}
              </div>
            )}
            {reviewed.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reviewed ({reviewed.length})</p>
                {reviewed.map((s) => (
                  <SubmissionCard key={s.id} sub={s} campaignId={campaign.id} brandWallet={brandWallet} onReviewed={() => q.refetch()} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
