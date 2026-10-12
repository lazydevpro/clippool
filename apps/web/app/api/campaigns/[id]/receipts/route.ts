import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { HttpError, json, parseCampaignId, route } from "@/lib/server/http";
import { getCampaignRow, getReceipts } from "@/lib/server/queries";
import type { ReceiptsResponse } from "@/lib/shared/api-types";

export const GET = route("GET /api/campaigns/[id]/receipts", async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await connection();
  const id = await parseCampaignId(ctx.params);
  const db = getDb();
  const campaign = await getCampaignRow(db, id);
  if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");
  return json<ReceiptsResponse>(await getReceipts(db, campaign), {
    headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" },
  });
});
