import { connection } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { HttpError, json, parseCampaignId, readJson, route } from "@/lib/server/http";
import { createDbStore } from "@/lib/server/store";
import type { ReviewSubmissionResponse } from "@/lib/shared/api-types";

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/campaigns/:id/submissions/:subId/review
 * Brand approves or rejects a pending submission.
 * The caller must be the campaign brand (verified via x-brand-wallet header).
 */
export const POST = route(
  "POST /api/campaigns/[id]/submissions/[subId]/review",
  async (req: Request, ctx: { params: Promise<{ id: string; subId: string }> }) => {
    await connection();
    const { id: idRaw, subId: subIdRaw } = await ctx.params;
    const campaignId = await parseCampaignId(Promise.resolve({ id: idRaw }));

    const subId = parseInt(subIdRaw, 10);
    if (!Number.isFinite(subId) || subId <= 0) {
      throw new HttpError(400, "invalid_submission_id", "Submission id must be a positive integer");
    }

    const brandWallet = req.headers.get("x-brand-wallet");
    if (!brandWallet) throw new HttpError(400, "missing_wallet", "x-brand-wallet header is required");

    const db = getDb();
    const [campaign] = await db.select({ brand: campaigns.brand })
      .from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");
    if (campaign.brand.toLowerCase() !== brandWallet.toLowerCase()) {
      throw new HttpError(403, "forbidden", "Only the campaign brand can review submissions");
    }

    const body = reviewSchema.parse(await readJson(req));

    const store = createDbStore(db);
    const updated = await store.reviewSubmission(campaignId, subId, body.decision, body.note);
    if (!updated) throw new HttpError(404, "submission_not_found", "Submission not found for this campaign");

    return json<ReviewSubmissionResponse>({ ok: true, decision: body.decision });
  },
);
