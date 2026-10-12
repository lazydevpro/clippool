import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { HttpError, json, parseCampaignId, route } from "@/lib/server/http";
import { getCampaignRow, getPublishedSnapshot } from "@/lib/server/queries";

/** The published snapshot JSON (hash posted onchain). 404 before posting and after the 30-day purge. */
export const GET = route("GET /api/campaigns/[id]/snapshot", async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await connection();
  const id = await parseCampaignId(ctx.params);
  const db = getDb();
  const campaign = await getCampaignRow(db, id);
  if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");
  const snap = await getPublishedSnapshot(db, campaign);
  if (!snap) throw new HttpError(404, "snapshot_unavailable", "No published snapshot (not posted yet, or purged after 30 days).");
  return json(snap.json, { headers: { "cache-control": "public, s-maxage=300", "x-snapshot-hash": snap.hash } });
});
