"use client";

import { useReadContracts } from "wagmi";
import { CLIPPOOL, USE_MOCKS } from "@/lib/client/env";
import { clipPoolAbi } from "@/lib/shared/abi";
import { activeChain } from "@/lib/shared/chain";
import { FALLBACK_WINDOWS, type ContractWindows } from "@/lib/shared/status";

export interface ContractWindowsState extends ContractWindows {
  /** True while the contract hasn't been read (loading, error, no address, mock mode): values are the 48h / 1h fallback. */
  isFallback: boolean;
  isLoading: boolean;
}

/**
 * ClipPool's deploy-time `DISPUTE_WINDOW()` / `MIN_MEASUREMENT_DELAY()` (mainnet 48h / 1h, testnet 10 min / 5 min),
 * read once from the deployed contract and cached for the session. For a campaign already in the API, prefer
 * `campaign.disputeWindow`.
 */
export function useContractWindows(): ContractWindowsState {
  const enabled = Boolean(CLIPPOOL) && !USE_MOCKS;
  const q = useReadContracts({
    contracts: [
      { address: CLIPPOOL ?? undefined, abi: clipPoolAbi, functionName: "DISPUTE_WINDOW", chainId: activeChain.id },
      { address: CLIPPOOL ?? undefined, abi: clipPoolAbi, functionName: "MIN_MEASUREMENT_DELAY", chainId: activeChain.id },
    ],
    allowFailure: false,
    query: { enabled, staleTime: Infinity, gcTime: Infinity, retry: 2 },
  });
  if (!q.data) return { ...FALLBACK_WINDOWS, isFallback: true, isLoading: enabled && q.isLoading };
  const [w, m] = q.data;
  return { disputeWindow: Number(w), minMeasurementDelay: Number(m), isFallback: false, isLoading: false };
}
