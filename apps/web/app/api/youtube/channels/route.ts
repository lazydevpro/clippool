import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { createDbChannelOwnerStore, linkedChannels, parseWalletQuery } from "@/lib/server/channels";
import { clientIp, createRateLimiter, jsonError, json, route } from "@/lib/server/http";
import { getYouTube } from "@/lib/server/services";
import type { YouTubeClient } from "@/lib/server/youtube";
import type { YouTubeChannelsResponse } from "@/lib/shared/api-types";

const limiter = createRateLimiter(60, 60_000);

function youtubeOrNull(): YouTubeClient | null {
  try {
    return getYouTube();
  } catch {
    return null; // no API key: fall back to stored titles, no thumbnails
  }
}

/** GET /api/youtube/channels?wallet=0x… → channels linked (via Connect YouTube) to that wallet. */
export const GET = route("GET /api/youtube/channels", async (req: Request) => {
  await connection();
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many requests — try again shortly.", undefined, { "retry-after": String(rl.retryAfterSec) });
  const wallet = parseWalletQuery(req.url);
  const res = await linkedChannels(createDbChannelOwnerStore(getDb()), youtubeOrNull(), wallet);
  return json<YouTubeChannelsResponse>(res, { headers: { "cache-control": "no-store" } });
});
