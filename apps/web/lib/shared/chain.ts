import { arc, arcTestnet } from "viem/chains";
import type { Address } from "viem";

export const CHAINS = { arc, arcTestnet } as const;
export type ChainKey = keyof typeof CHAINS;

export const chainKey = (process.env.NEXT_PUBLIC_CHAIN ?? "arcTestnet") as ChainKey;
export const activeChain = CHAINS[chainKey];

export const TOKENS: Record<ChainKey, { USDC: Address; EURC: Address }> = {
  arc: {
    USDC: "0x3600000000000000000000000000000000000000",
    EURC: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  },
  arcTestnet: {
    USDC: "0x3600000000000000000000000000000000000000",
    EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
};
export const TOKEN_DECIMALS = 6;
export type TokenSymbol = "USDC" | "EURC";

export const EXPLORER_URL: Record<ChainKey, string> = {
  arc: "https://explorer.arc.io",
  arcTestnet: "https://explorer.testnet.arc.io",
};
export const explorerTx = (hash: string) => `${EXPLORER_URL[chainKey]}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL[chainKey]}/address/${addr}`;

export const clipPoolAddress = process.env.NEXT_PUBLIC_CLIPPOOL_ADDRESS as Address | undefined;

/** Arc rejects txs with maxFeePerGas below 20 gwei. */
export const MIN_MAX_FEE_PER_GAS = 20_000_000_000n;
