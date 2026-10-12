import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { createDbChannelOwnerStore, createEligibleCache, findEligibleShorts, parseWalletQuery } from "@/lib/server/channels";
import { clientIp, createRateLimiter, HttpError, jsonError, json, parseCampaignId, route } from "@/lib/server/http";
import { getCampaignRow } from "@/lib/server/queries";
import { getYouTube } from "@/lib/server/services";
import type { EligibleShortsResponse } from "@/lib/shared/api-types";

const limiter = createRateLimiter(20, 60_000); // each uncached call costs ~2–3 YouTube quota units per channel
const cache = createEligibleCache(); // ~60 s per (campaign, connected channels)

/**
 * GET /api/campaigns/:id/eligible-shorts?wallet=0x… → recent uploads of the wallet's connected channels
 * that pass the campaign's static rules (public, ≤180 s, published in the window).
 */
export const GET = route(
  "GET /api/campaigns/[id]/eligible-shorts",
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await connection();
    const rl = limiter.check(clientIp(req));
    if (!rl.ok) return jsonError(429, "rate_limited", "Too many requests — try again shortly.", undefined, { "retry-after": String(rl.retryAfterSec) });
    const id = await parseCampaignId(ctx.params);
    const wallet = parseWalletQuery(req.url);
    const db = getDb();
    const campaign = await getCampaignRow(db, id);
    if (!campaign) throw new HttpError(404, "campaign_not_found", "Campaign not found");
    const owners = createDbChannelOwnerStore(db);
    // Wallets with no connected channel need no YouTube call (and no API key).
    if ((await owners.channelsOf(wallet)).length === 0) {
      return json<EligibleShortsResponse>({ wallet, channels: [], shorts: [] }, { headers: { "cache-control": "no-store" } });
    }
    const res = await findEligibleShorts(owners, getYouTube(), campaign, wallet, cache);
    return json<EligibleShortsResponse>(res, { headers: { "cache-control": "no-store" } });
  },
);
