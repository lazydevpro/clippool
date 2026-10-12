import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { campaignMeta } from "@/lib/db/schema";
import { getReadGateway } from "@/lib/server/chain";
import { HttpError, json, parseCampaignId, readJson, route } from "@/lib/server/http";
import { verifyCampaignMeta } from "@/lib/server/meta";
import { getStore } from "@/lib/server/services";

const Body = z.object({
  title: z.string().trim().min(1).max(120),
  // Must hash to the onchain rulesHash byte-for-byte, so no trimming.
  rules: z.string().min(1).max(20_000),
  createTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s as `0x${string}`),
});

/**
 * Brand attaches title + rules after createCampaign. First verified write wins (409 afterwards):
 * the request is not signed, so later writes could only be griefing — rules are pinned by hash.
 */
export const POST = route("POST /api/campaigns/[id]/meta", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = await parseCampaignId(ctx.params);
  const body = Body.parse(await readJson(req));
  const db = getDb();
  const [existing] = await db.select().from(campaignMeta).where(eq(campaignMeta.campaignId, id));
  if (existing?.verified) {
    if (existing.title === body.title && existing.rules === body.rules) return json({ ok: true, campaignId: String(id) });
    throw new HttpError(409, "meta_already_set", "Campaign metadata is already set.");
  }
  const gateway = getReadGateway();
  const { onchain, createdBlock } = await verifyCampaignMeta(gateway, id, body);
  const { disputeWindow } = await gateway.getWindows();
  await getStore().upsertCampaign(id, onchain, disputeWindow, { createTx: body.createTx, createdBlock });
  await db
    .insert(campaignMeta)
    .values({ campaignId: id, title: body.title, rules: body.rules, verified: true })
    .onConflictDoUpdate({ target: campaignMeta.campaignId, set: { title: body.title, rules: body.rules, verified: true } });
  return json({ ok: true, campaignId: String(id) }, { status: 201 });
});
