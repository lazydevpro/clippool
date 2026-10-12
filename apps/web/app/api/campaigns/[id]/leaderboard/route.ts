import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { HttpError, json, parseCampaignId, route } from "@/lib/server/http";
import { buildLeaderboard, getCampaignRow, leaderboardRows } from "@/lib/server/queries";
import type { LeaderboardResponse } from "@/lib/shared/api-types";

const TTL_MS = 60_000;
const cache = new Map<number, { at: number; body: LeaderboardResponse }>();

export const GET = route("GET /api/campaigns/[id]/leaderboard", async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await connection();
  const id = await parseCampaignId(ctx.params);
  const headers = { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body, { headers });

  const db = getDb();
  const campaign = await getCampaignRow(db, id);
  if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");
  const now = Math.floor(Date.now() / 1000);
  const body = buildLeaderboard(campaign, await leaderboardRows(db, id, now), now);
  if (cache.size > 500) cache.clear();
  cache.set(id, { at: Date.now(), body });
  return json<LeaderboardResponse>(body, { headers });
});
