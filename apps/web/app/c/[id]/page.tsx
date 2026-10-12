import type { Metadata } from "next";
import { Suspense } from "react";
import { CampaignPageSkeleton } from "@/components/campaign/campaign-loader";
import { CampaignView } from "@/components/campaign/campaign-view";

export async function generateMetadata({ params }: PageProps<"/c/[id]">): Promise<Metadata> {
  const { id } = await params;
  const title = `Campaign #${id}`;
  const description = "Live pro-rata leaderboard: post a YouTube Short, earn a share of the pool by views, paid in USDC on Arc.";
  return { title, description, openGraph: { title: `${title} · ClipPool`, description } };
}

export default function CampaignPage({ params }: PageProps<"/c/[id]">) {
  return (
    <Suspense fallback={<CampaignPageSkeleton />}>
      {params.then(({ id }) => (
        <CampaignView id={id} />
      ))}
    </Suspense>
  );
}
