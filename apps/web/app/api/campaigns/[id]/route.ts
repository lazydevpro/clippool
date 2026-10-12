import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getContractWindows } from "@/lib/server/chain";
import { env } from "@/lib/server/env";
import { HttpError, json, parseCampaignId, route } from "@/lib/server/http";
import { getCampaignDetail } from "@/lib/server/queries";
import type { CampaignDetail } from "@/lib/shared/api-types";

export const GET = route("GET /api/campaigns/[id]", async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await connection();
  const id = await parseCampaignId(ctx.params);
  const { disputeWindow } = await getContractWindows();
  const detail = await getCampaignDetail(getDb(), id, env.chainKey(), Math.floor(Date.now() / 1000), disputeWindow);
  if (!detail) throw new HttpError(404, "campaign_not_found", "Campaign not found");
  return json<CampaignDetail>(detail, { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" } });
});
