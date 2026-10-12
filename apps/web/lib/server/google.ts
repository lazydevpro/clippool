import { HttpError } from "./http";
import { pickThumbnail } from "./youtube";

/**
 * Google OAuth (Google Identity Services token client) helpers for "Connect YouTube".
 * The browser obtains a short-lived access token with the read-only `youtube.readonly` scope and
 * hands it to POST /api/youtube/connect, which verifies it here, reads the caller's own channels and
 * forgets the token. Nothing token-related is logged or stored.
 */

export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const MY_CHANNELS = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50";

export interface VerifiedToken {
  scopes: string[];
  /** Seconds until expiry, as reported by Google. */
  expiresIn: number;
}

export interface OwnedChannel {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
}

const invalidToken = (message = "Google sign-in expired or was not for ClipPool. Please connect again.") =>
  new HttpError(401, "invalid_token", message);
const upstream = () => new HttpError(502, "google_unavailable", "Couldn't reach Google. Please try again.");

/* eslint-disable @typescript-eslint/no-explicit-any */
async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Verify an access token with Google's tokeninfo endpoint.
 * - `aud` or `azp` must equal our OAuth client id (tokens minted for other apps can't be replayed here);
 * - `scope` must include youtube.readonly;
 * - token must not be expired.
 * Google 4xx → 401 invalid_token; network / 5xx → 502.
 */
export async function verifyGoogleAccessToken(
  accessToken: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedToken> {
  let res: Response;
  try {
    // The URL carries the token: never log it, and swallow fetch errors (they can echo the URL).
    res = await fetchImpl(`${TOKENINFO}?${new URLSearchParams({ access_token: accessToken })}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw upstream();
  }
  if (res.status >= 500) throw upstream();
  const body = await safeJson(res);
  if (!res.ok || !body || typeof body !== "object" || body.error || body.error_description) throw invalidToken();

  const aud = typeof body.aud === "string" ? body.aud : "";
  const azp = typeof body.azp === "string" ? body.azp : "";
  if (!clientId || (aud !== clientId && azp !== clientId)) {
    throw invalidToken("This Google sign-in was issued for a different app.");
  }
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(YOUTUBE_READONLY_SCOPE)) {
    throw invalidToken("Please allow ClipPool to see your YouTube channel (read-only) and try again.");
  }
  const expiresIn = Number(body.expires_in);
  const exp = Number(body.exp);
  const left = Number.isFinite(expiresIn) ? expiresIn : Number.isFinite(exp) ? exp - now : NaN;
  if (!Number.isFinite(left) || left <= 0 || (Number.isFinite(exp) && exp <= now)) throw invalidToken();
  return { scopes, expiresIn: left };
}

export function mapOwnedChannel(item: any): OwnedChannel | null {
  if (!item || typeof item.id !== "string" || !/^UC[A-Za-z0-9_-]{22}$/.test(item.id)) return null;
  return { channelId: item.id, title: String(item.snippet?.title ?? ""), thumbnailUrl: pickThumbnail(item.snippet?.thumbnails) };
}

/** channels.list?mine=true with the user's token → the channels this Google identity owns. */
export async function listOwnedChannels(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<OwnedChannel[]> {
  let res: Response;
  try {
    res = await fetchImpl(MY_CHANNELS, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw upstream();
  }
  if (res.status === 401 || res.status === 403) {
    const body = await safeJson(res);
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
      throw new HttpError(503, "youtube_quota", "YouTube is busy right now. Please try again later.");
    }
    throw invalidToken();
  }
  if (res.status === 404) return []; // some accounts without a channel answer 404 channelNotFound
  if (!res.ok) throw upstream();
  const body = await safeJson(res);
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  const seen = new Set<string>();
  const out: OwnedChannel[] = [];
  for (const it of items) {
    const c = mapOwnedChannel(it);
    if (c && !seen.has(c.channelId)) {
      seen.add(c.channelId);
      out.push(c);
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface GoogleOAuth {
  verify(accessToken: string): Promise<VerifiedToken>;
  ownedChannels(accessToken: string): Promise<OwnedChannel[]>;
}

export function createGoogleOAuth(clientId: string, fetchImpl: typeof fetch = fetch): GoogleOAuth {
  return {
    verify: (t) => verifyGoogleAccessToken(t, clientId, fetchImpl),
    ownedChannels: (t) => listOwnedChannels(t, fetchImpl),
  };
}
