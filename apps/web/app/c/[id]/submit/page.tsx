import type { Metadata } from "next";
import { Suspense } from "react";
import { CampaignPageSkeleton } from "@/components/campaign/campaign-loader";
import { SubmitFlow } from "@/components/submit/submit-flow";

export async function generateMetadata({ params }: PageProps<"/c/[id]/submit">): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Submit a Short · Campaign #${id}`,
    description: "Connect YouTube, pick your eligible Shorts, and submit. No gas, no signup fee.",
  };
}

export default function SubmitPage({ params }: PageProps<"/c/[id]/submit">) {
  return (
    <Suspense fallback={<CampaignPageSkeleton />}>
      {params.then(({ id }) => (
        <SubmitFlow id={id} />
      ))}
    </Suspense>
  );
}
