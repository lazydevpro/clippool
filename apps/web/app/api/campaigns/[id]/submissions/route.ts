import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { campaigns, submissions, viewObservations } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { HttpError, json, parseCampaignId, route } from "@/lib/server/http";
import type { CampaignSubmissionsResponse, SubmissionForReview } from "@/lib/shared/api-types";

/**
 * GET /api/campaigns/:id/submissions?wallet=<brandWallet>
 * Returns all submissions for a campaign, for brand review.
 * Only the campaign brand may access this.
 */
export const GET = route(
  "GET /api/campaigns/[id]/submissions",
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await connection();
    const campaignId = await parseCampaignId(ctx.params);
    const db = getDb();

    const wallet = new URL(req.url).searchParams.get("wallet");
    if (!wallet) throw new HttpError(400, "missing_wallet", "wallet query parameter is required");

    // Verify the caller is the campaign brand.
    const [campaign] = await db.select({ brand: campaigns.brand, requiresApproval: campaigns.requiresApproval })
      .from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");
    if (campaign.brand.toLowerCase() !== wallet.toLowerCase()) {
      throw new HttpError(403, "forbidden", "Only the campaign brand can view submission reviews");
    }

    // Fetch all submissions for this campaign (pending_approval, accepted, rejected).
    const rows = await db
      .select({
        id: submissions.id,
        videoId: submissions.videoId,
        channelId: submissions.channelId,
        channelTitle: submissions.channelTitle,
        title: submissions.title,
        thumbnailUrl: submissions.thumbnailUrl,
        wallet: submissions.wallet,
        publishedAt: submissions.publishedAt,
        brandReview: submissions.brandReview,
        brandReviewNote: submissions.brandReviewNote,
        status: submissions.status,
        latestViews: sql<number | null>`(
          select vo.views
          from ${viewObservations} vo
          where vo.submission_id = ${submissions.id}
          order by vo.fetched_at desc
          limit 1
        )`,
      })
      .from(submissions)
      .where(eq(submissions.campaignId, campaignId))
      .orderBy(desc(submissions.id));

    const result: SubmissionForReview[] = rows.map((r) => ({
      id: r.id,
      videoId: r.videoId,
      channelId: r.channelId,
      channelTitle: r.channelTitle,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      wallet: getAddress(r.wallet),
      publishedAt: Math.floor(r.publishedAt.getTime() / 1000),
      brandReview: r.brandReview,
      brandReviewNote: r.brandReviewNote ?? null,
      views: r.latestViews ?? null,
      likes: null,    // not stored server-side yet
      comments: null, // not stored server-side yet
    }));

    return json<CampaignSubmissionsResponse>({ submissions: result });
  },
);
