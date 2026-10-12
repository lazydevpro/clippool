import { getAddress, isAddress, type Address } from "viem";
import { activeChain, chainKey, clipPoolAddress } from "@/lib/shared/chain";

// NEXT_PUBLIC_* values must be referenced literally so Next can inline them into the client bundle.
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "1";
export const CIRCLE_APP_ID = (process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "").trim();
export const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
export const PUBLIC_RPC_URL = (process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "").trim() || undefined;
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "http://localhost:3000";

/** Circle social login needs both the Circle app id and a Google OAuth client id. Mocks simulate it. */
export const CIRCLE_LOGIN_ENABLED = USE_MOCKS || Boolean(CIRCLE_APP_ID && GOOGLE_CLIENT_ID);

/** "Connect YouTube" (Google OAuth, youtube.readonly) needs the Google OAuth client id. Mocks simulate it. */
export const YOUTUBE_CONNECT_ENABLED = USE_MOCKS || Boolean(GOOGLE_CLIENT_ID);

/** The deployed ClipPool contract, or null when NEXT_PUBLIC_CLIPPOOL_ADDRESS is empty/malformed. */
export const CLIPPOOL: Address | null =
  clipPoolAddress && isAddress(clipPoolAddress, { strict: false }) ? getAddress(clipPoolAddress) : null;

export const RPC_FOR_DISPLAY = PUBLIC_RPC_URL ?? activeChain.rpcUrls.default.http[0];
export const CHAIN_NAME = activeChain.name;
export const IS_TESTNET = chainKey === "arcTestnet";
/** Circle wallet `blockchain` identifier for the active chain. */
export const CIRCLE_BLOCKCHAIN = IS_TESTNET ? "ARC-TESTNET" : "ARC";
