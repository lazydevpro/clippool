"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";

/** Retry only transient failures (network / gateway). 4xx and "not configured" 503s fail fast. */
const retry = (count: number, err: unknown) => {
  const status = (err as { status?: number } | null)?.status;
  return count < 2 && (status === undefined || status === 0 || status === 502 || status === 504);
};

export function useCampaigns() {
  return useQuery({ queryKey: ["campaigns"], queryFn: api.listCampaigns, refetchInterval: 60_000, retry });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api.getCampaign(id!),
    enabled: Boolean(id),
    refetchInterval: 60_000,
    retry,
  });
}

export function useLeaderboard(id: string | undefined) {
  return useQuery({
    queryKey: ["leaderboard", id],
    queryFn: () => api.getLeaderboard(id!),
    enabled: Boolean(id),
    refetchInterval: 60_000,
    retry,
  });
}

export function useReceipts(id: string | undefined) {
  return useQuery({
    queryKey: ["receipts", id],
    queryFn: () => api.getReceipts(id!),
    enabled: Boolean(id),
    refetchInterval: 60_000,
    retry,
  });
}

export function useCircleWallets(userToken: string | undefined) {
  return useQuery({
    queryKey: ["circle-wallets", userToken],
    queryFn: () => api.circleWallets(userToken!),
    enabled: Boolean(userToken),
    refetchInterval: 30_000,
    retry,
  });
}
