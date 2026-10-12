import type { Metadata } from "next";
import { CreateCampaignForm } from "@/components/create/create-campaign-form";

export const metadata: Metadata = {
  title: "Launch a campaign",
  description:
    "Lock a USDC or EURC pool on Arc and let creators compete for it with YouTube Shorts. Split by views, capped per creator, paid instantly.",
};

export default function NewCampaignPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 max-w-2xl space-y-3">
        <p className="text-sm font-medium text-primary dark:text-brand-soft">For brands</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Launch a campaign</h1>
        <p className="text-muted-foreground">
          Fund a pool in one transaction. Creators post Shorts with your rules; when the campaign ends the pool is split by
          views and paid out automatically.
        </p>
      </header>
      <CreateCampaignForm />
    </div>
  );
}
