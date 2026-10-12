import "server-only";
import { and, eq } from "drizzle-orm";
import { getAddress } from "viem";
import type { Db } from "@/lib/db";
import { campaigns, channelOwners, channelWallets, submissions, viewObservations } from "@/lib/db/schema";
import type { SubmissionResponse } from "@/lib/shared/api-types";
import { HttpError } from "./http";
import { countableViews, parseVideoId, precheckSubmission, validateSubmission, type YouTubeClient } from "./youtube";

export interface SubmitInput {
  campaignId: number;
  videoUrl: string;
  wallet: `0x${string}`;
}

const rejected = (reason: NonNullable<SubmissionResponse["reason"]>, message: string): SubmissionResponse => ({
  status: "rejected",
  reason,
  message,
});

/**
 * POST /api/submissions core: validate against YouTube + campaign rules, then lock channel and insert.
 * Ownership proof: the channel was connected via Google OAuth to this wallet (channel_owners), or the
 * description contains the binding code.
 */
export async function submitVideo(db: Db, youtube: YouTubeClient, input: SubmitInput, now: number): Promise<SubmissionResponse> {
  const wallet = getAddress(input.wallet);
  const videoId = parseVideoId(input.videoUrl);
  if (!videoId) return rejected("invalid_url", "Paste a YouTube Shorts link (youtube.com/shorts/… or youtu.be/…).");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, input.campaignId));
  if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");

  const dup = async () =>
    (
      await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.campaignId, campaign.id), eq(submissions.videoId, videoId), eq(submissions.status, "accepted")))
    ).length > 0;

  const pre = precheckSubmission(campaign, { duplicate: await dup() }, now);
  if (pre.status === "rejected") return rejected(pre.reason, pre.message);

  const video = (await youtube.getVideos([videoId])).get(videoId) ?? null;
  const channel = video?.channelId ? ((await youtube.getChannels([video.channelId])).get(video.channelId) ?? null) : null;
  const lockedTo = async (channelId: string) =>
    (
      await db
        .select({ wallet: channelWallets.wallet })
        .from(channelWallets)
        .where(and(eq(channelWallets.campaignId, campaign.id), eq(channelWallets.channelId, channelId)))
    )[0]?.wallet ?? null;

  const ownerOf = async (channelId: string) =>
    (await db.select({ wallet: channelOwners.wallet }).from(channelOwners).where(eq(channelOwners.channelId, channelId)))[0]
      ?.wallet ?? null;

  const verdict = validateSubmission(
    { campaignId: campaign.id, wallet, videoId },
    campaign,
    video,
    channel,
    {
      duplicate: false,
      channelWallet: video ? await lockedTo(video.channelId) : null,
      channelOwner: video?.channelId ? await ownerOf(video.channelId) : null,
    },
    now,
  );
  if (verdict.status === "rejected") return rejected(verdict.reason, verdict.message);
  const v = video!;

  // Lock channel → wallet (first valid submission wins; unique index settles races).
  await db.insert(channelWallets).values({ campaignId: campaign.id, channelId: v.channelId, wallet }).onConflictDoNothing();
  const owner = await lockedTo(v.channelId);
  if (owner && owner.toLowerCase() !== wallet.toLowerCase()) {
    return rejected("channel_locked_to_other_wallet", "This channel is already linked to a different payout wallet for this campaign.");
  }

  const inserted = await db
    .insert(submissions)
    .values({
      campaignId: campaign.id,
      videoId,
      channelId: v.channelId,
      channelTitle: v.channelTitle,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      wallet,
      publishedAt: new Date(v.publishedAt * 1000),
      durationSec: v.durationSec ?? 0,
      status: "accepted",
      proof: verdict.proof,
    })
    .onConflictDoNothing()
    .returning({ id: submissions.id });
  if (inserted.length === 0) return rejected("duplicate", "This video was already submitted to this campaign.");

  const views = countableViews(v);
  await db.insert(viewObservations).values({ submissionId: inserted[0]!.id, views, fetchedAt: new Date(now * 1000) });
  return {
    status: "accepted",
    submission: { videoId, channelId: v.channelId, channelTitle: v.channelTitle, title: v.title, views, proof: verdict.proof },
  };
}
