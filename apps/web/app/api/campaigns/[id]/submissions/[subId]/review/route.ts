import { connection } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPublicClient } from "@/lib/server/chain";
import { HttpError, json, parseCampaignId, readJson, route } from "@/lib/server/http";
import { assertBrandReview } from "@/lib/server/review";
import { createDbStore } from "@/lib/server/store";
import type { ReviewSubmissionResponse } from "@/lib/shared/api-types";

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
  issuedAt: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/**
 * POST /api/campaigns/:id/submissions/:subId/review
 * Brand approves or rejects a pending submission. The body carries the brand wallet's signature over
 * `reviewMessage(...)` (lib/shared/review.ts); the brand address alone is public, so it is not proof.
 */
export const POST = route(
  "POST /api/campaigns/[id]/submissions/[subId]/review",
  async (req: Request, ctx: { params: Promise<{ id: string; subId: string }> }) => {
    await connection();
    const { id: idRaw, subId: subIdRaw } = await ctx.params;
    const campaignId = await parseCampaignId(Promise.resolve({ id: idRaw }));

    const subId = Number(subIdRaw);
    if (!Number.isSafeInteger(subId) || subId <= 0) {
      throw new HttpError(400, "invalid_submission_id", "Submission id must be a positive integer");
    }

    const body = reviewSchema.parse(await readJson(req));

    const db = getDb();
    const [campaign] = await db
      .select({ id: campaigns.id, brand: campaigns.brand, snapshotTime: campaigns.snapshotTime })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");

    const client = getPublicClient();
    await assertBrandReview(
      {
        campaign,
        submissionId: subId,
        decision: body.decision,
        issuedAt: body.issuedAt,
        signature: body.signature as `0x${string}`,
        now: Math.floor(Date.now() / 1000),
      },
      (args) => client.verifyMessage(args),
    );

    const store = createDbStore(db);
    const updated = await store.reviewSubmission(campaignId, subId, body.decision, body.note);
    if (!updated) throw new HttpError(404, "submission_not_found", "Submission not found for this campaign");

    return json<ReviewSubmissionResponse>({ ok: true, decision: body.decision });
  },
);
