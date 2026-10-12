import { getDb } from "@/lib/db";
import { ConnectBody, connectYouTube, createDbChannelOwnerStore } from "@/lib/server/channels";
import { clientIp, createRateLimiter, jsonError, json, readJson, route } from "@/lib/server/http";
import { getGoogleOAuth } from "@/lib/server/services";
import type { YouTubeChannelsResponse } from "@/lib/shared/api-types";

const limiter = createRateLimiter(10, 60_000); // 10 connects / minute / IP / instance

/**
 * Link the caller's YouTube channel(s) to a payout wallet. Body { accessToken, wallet }: a Google
 * token-client access token with youtube.readonly. The token is verified, used for one
 * channels.list?mine=true call and dropped — never stored or logged.
 */
export const POST = route("POST /api/youtube/connect", async (req: Request) => {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many attempts — try again shortly.", undefined, { "retry-after": String(rl.retryAfterSec) });
  const body = ConnectBody.parse(await readJson(req));
  const res = await connectYouTube(getGoogleOAuth(), createDbChannelOwnerStore(getDb()), body);
  return json<YouTubeChannelsResponse>(res, { headers: { "cache-control": "no-store" } });
});
