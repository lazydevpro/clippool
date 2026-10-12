import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getContractWindows } from "@/lib/server/chain";
import { env } from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { listCampaigns } from "@/lib/server/queries";
import type { CampaignListResponse } from "@/lib/shared/api-types";

export const GET = route("GET /api/campaigns", async () => {
  await connection();
  const { disputeWindow } = await getContractWindows();
  const campaigns = await listCampaigns(getDb(), env.chainKey(), Math.floor(Date.now() / 1000), disputeWindow);
  return json<CampaignListResponse>({ campaigns }, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" } });
});
