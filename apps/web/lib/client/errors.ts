import { BaseError, UserRejectedRequestError, ContractFunctionRevertedError } from "viem";
import type { SubmissionRejectReason } from "@/lib/shared/api-types";

export function isUserRejection(err: unknown): boolean {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return true;
  }
  const e = err as { code?: number; name?: string; message?: string } | null;
  if (e?.code === 4001) return true;
  if (e?.name === "UserRejectedRequestError") return true;
  return /user (rejected|denied)|rejected the request|denied transaction/i.test(e?.message ?? "");
}

/** Turn wallet / viem / fetch errors into one readable sentence. */
export function humanizeError(err: unknown): string {
  if (isUserRejection(err)) return "You cancelled the request in your wallet.";
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      return name ? `The contract rejected this transaction (${name}).` : revert.shortMessage;
    }
    if (/insufficient funds/i.test(err.message)) return "Not enough USDC in this wallet to pay network fees.";
    return err.shortMessage || err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

export const REJECT_MESSAGES: Record<SubmissionRejectReason, { title: string; hint: string }> = {
  invalid_url: {
    title: "That doesn't look like a YouTube Shorts link",
    hint: "Paste the share link, e.g. https://youtube.com/shorts/abc123XYZ09.",
  },
  video_not_found: {
    title: "We couldn't find that video",
    hint: "Check the link. If you just uploaded it, give YouTube a minute and try again.",
  },
  not_public: {
    title: "The video isn't public",
    hint: "Set the visibility to Public (not Unlisted or Private), then resubmit.",
  },
  not_short: {
    title: "This isn't a Short",
    hint: "Only YouTube Shorts (3 minutes or less) qualify for this campaign.",
  },
  outside_window: {
    title: "Posted outside the campaign window",
    hint: "The video must be published between the campaign's start and end time.",
  },
  missing_binding_code: {
    title: "We couldn't confirm this Short is yours",
    hint: "Connect your YouTube channel, or add your binding code to the Short's description.",
  },
  duplicate: {
    title: "Already submitted",
    hint: "This video is already part of the campaign. Nothing else to do.",
  },
  channel_locked_to_other_wallet: {
    title: "Channel linked to a different wallet",
    hint: "Each channel pays out to the first wallet it submitted with in this campaign. Use that wallet's code.",
  },
  campaign_not_live: {
    title: "Campaign isn't accepting submissions",
    hint: "Submissions are only accepted while the campaign is live.",
  },
  channel_too_new: {
    title: "Channel is too new",
    hint: "To keep the pool fair, very new channels can't join this campaign.",
  },
};
