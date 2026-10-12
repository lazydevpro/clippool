import type { Metadata } from "next";
import { CreatorDashboard } from "@/components/me/dashboard";

export const metadata: Metadata = {
  title: "Creator dashboard",
  description: "Your Arc wallet, USDC/EURC balances, and every ClipPool campaign you've earned from.",
};

export default function MePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium text-primary dark:text-brand-soft">For creators</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Creator dashboard</h1>
      </header>
      <CreatorDashboard />
    </div>
  );
}
