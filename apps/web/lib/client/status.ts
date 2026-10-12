import type { CampaignStatus } from "@/lib/shared/api-types";

export const STATUS_META: Record<
  CampaignStatus,
  { label: string; description: string; tone: "live" | "info" | "warning" | "success" | "neutral" }
> = {
  upcoming: { label: "Upcoming", description: "Submissions open soon.", tone: "neutral" },
  live: { label: "Live", description: "Accepting Shorts now.", tone: "live" },
  measuring: { label: "Measuring", description: "Submissions closed; views are still accruing.", tone: "info" },
  allocating: { label: "Allocating", description: "Final snapshot taken; computing the split.", tone: "info" },
  disputing: { label: "Dispute window", description: "Split published; open for review before payout.", tone: "warning" },
  paying: { label: "Paying out", description: "Payouts are being pushed to creators.", tone: "success" },
  completed: { label: "Completed", description: "Every allocation has been paid.", tone: "success" },
  refunded: { label: "Refunded", description: "No split was posted in time; the brand was refunded.", tone: "neutral" },
};

/** Statuses for which the receipts page has something to show. */
export const HAS_RECEIPTS: CampaignStatus[] = ["disputing", "paying", "completed"];
export const ACCEPTS_SUBMISSIONS: CampaignStatus[] = ["live"];
