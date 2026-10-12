import type { Metadata } from "next";
import { Suspense } from "react";
import { CampaignPageSkeleton } from "@/components/campaign/campaign-loader";
import { ReceiptsView } from "@/components/receipts/receipts-view";

export async function generateMetadata({ params }: PageProps<"/c/[id]/receipts">): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Payout receipts · Campaign #${id}`,
    description: "Every allocation, its onchain payout transaction, and the Merkle root anyone can recompute.",
  };
}

export default function ReceiptsPage({ params }: PageProps<"/c/[id]/receipts">) {
  return (
    <Suspense fallback={<CampaignPageSkeleton />}>
      {params.then(({ id }) => (
        <ReceiptsView id={id} />
      ))}
    </Suspense>
  );
}
