"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import type { CampaignDetail } from "@/lib/shared/api-types";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useCampaign } from "@/hooks/use-api";
import { isNotFound } from "@/lib/client/api";

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 ${className}`}>{children}</div>;
}

export function CampaignPageSkeleton() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-label="Loading campaign" className="space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    </PageContainer>
  );
}

export function CampaignNotFound({ id }: { id: string }) {
  return (
    <PageContainer>
      <EmptyState
        icon={<SearchXIcon className="size-5" aria-hidden />}
        title={`Campaign #${id} not found`}
        description="It may not exist yet, or the indexer hasn't picked it up. New campaigns appear within a minute of creation."
        action={
          <Link href="/#campaigns" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Browse campaigns
          </Link>
        }
        className="py-20"
      />
    </PageContainer>
  );
}

/** Loads a campaign by id and renders loading / not-found / error states around `children`. */
export function CampaignLoader({ id, children }: { id: string; children: (c: CampaignDetail) => ReactNode }) {
  const valid = /^\d+$/.test(id) && id !== "0";
  const q = useCampaign(valid ? id : undefined);
  if (!valid) return <CampaignNotFound id={id} />;
  if (q.isPending) return <CampaignPageSkeleton />;
  if (q.isError) {
    if (isNotFound(q.error)) return <CampaignNotFound id={id} />;
    return (
      <PageContainer>
        <ErrorState title="Couldn't load this campaign" error={q.error} onRetry={() => q.refetch()} className="py-20" />
      </PageContainer>
    );
  }
  return <>{children(q.data)}</>;
}
