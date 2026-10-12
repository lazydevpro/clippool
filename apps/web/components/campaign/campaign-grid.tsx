"use client";

import Link from "next/link";
import { MegaphoneIcon } from "lucide-react";
import type { CampaignStatus } from "@/lib/shared/api-types";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useCampaigns } from "@/hooks/use-api";
import { CampaignCard, CampaignCardSkeleton } from "./campaign-card";

const ORDER: CampaignStatus[] = ["live", "upcoming", "measuring", "allocating", "disputing", "paying", "completed", "refunded"];

export function CampaignGrid({ limit }: { limit?: number }) {
  const q = useCampaigns();
  if (q.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading campaigns">
        {Array.from({ length: 3 }, (_, i) => (
          <CampaignCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (q.isError) {
    return <ErrorState title="Couldn't load campaigns" error={q.error} onRetry={() => q.refetch()} />;
  }
  const campaigns = [...q.data.campaigns].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || Number(b.id) - Number(a.id),
  );
  if (!campaigns.length) {
    return (
      <EmptyState
        icon={<MegaphoneIcon className="size-5" aria-hidden />}
        title="No campaigns yet"
        description="Be the first brand to fund a pool on Arc."
        action={
          <Link href="/campaigns/new" className={buttonVariants({ size: "sm" })}>
            Launch a campaign
          </Link>
        }
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {campaigns.slice(0, limit).map((c) => (
        <CampaignCard key={c.id} c={c} />
      ))}
    </div>
  );
}
