"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { USE_MOCKS, YOUTUBE_CONNECT_ENABLED } from "@/lib/client/env";
import { humanizeError } from "@/lib/client/errors";
import { loadGoogleIdentity, requestYouTubeAccessToken } from "@/lib/client/google-oauth";
import type { YouTubeChannelsResponse } from "@/lib/shared/api-types";

const retry = (count: number, err: unknown) => {
  const status = (err as { status?: number } | null)?.status;
  return count < 2 && (status === undefined || status === 0 || status === 502 || status === 504);
};

export const ytChannelsKey = (wallet: string | undefined) => ["yt-channels", wallet?.toLowerCase()] as const;

/** Channels linked to a payout wallet via Connect YouTube. */
export function useYouTubeChannels(wallet: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ytChannelsKey(wallet),
    queryFn: () => api.youtubeChannels(wallet!),
    enabled: Boolean(wallet) && enabled && YOUTUBE_CONNECT_ENABLED,
    staleTime: 60_000,
    retry,
  });
}

/** Shorts from the wallet's connected channels that pass the campaign's static rules. */
export function useEligibleShorts(campaignId: string, wallet: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["eligible-shorts", campaignId, wallet?.toLowerCase()],
    queryFn: () => api.eligibleShorts(campaignId, wallet!),
    enabled: Boolean(wallet) && enabled,
    staleTime: 30_000,
    retry,
  });
}

/**
 * Google popup → access token → POST /api/youtube/connect → drop the token.
 * Preloads Google Identity Services on mount so the click opens the popup without a blocker.
 */
export function useConnectYouTube(wallet: string | undefined) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_MOCKS && YOUTUBE_CONNECT_ENABLED) loadGoogleIdentity().catch(() => {}); // surfaced on click instead
  }, []);

  const connect = useCallback(
    async (opts: { selectAccount?: boolean } = {}): Promise<YouTubeChannelsResponse | null> => {
      if (!wallet) return null;
      setError(null);
      setPending(true);
      try {
        // The token lives only in this scope: sent once, never stored or logged.
        const accessToken = USE_MOCKS ? "mock-google-access-token" : await requestYouTubeAccessToken(opts);
        const res = await api.connectYouTube({ accessToken, wallet: wallet as `0x${string}` });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["yt-channels"] }), // a channel may have moved between wallets
          qc.invalidateQueries({ queryKey: ["eligible-shorts"] }),
        ]);
        return res;
      } catch (err) {
        setError(humanizeError(err));
        return null;
      } finally {
        setPending(false);
      }
    },
    [qc, wallet],
  );

  return { connect, pending, error, clearError: () => setError(null) };
}
