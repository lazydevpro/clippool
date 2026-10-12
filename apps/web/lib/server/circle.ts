import "server-only";
import type { CircleUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { erc20PermitAbi } from "@/lib/shared/abi";
import type { CircleInitializeResponse, CircleWalletsResponse } from "@/lib/shared/api-types";
import { TOKENS, type ChainKey } from "@/lib/shared/chain";
import { HttpError } from "./http";
import type { PublicClient } from "viem";

/** Circle's blockchain codes (verified against @circle-fin/user-controlled-wallets `Blockchain`). */
export function circleBlockchain(chainKey: ChainKey): "ARC" | "ARC-TESTNET" {
  return chainKey === "arc" ? "ARC" : "ARC-TESTNET";
}

type Wallet = { id: string; address: `0x${string}`; blockchain: string };

function mapWallets(ws: { id: string; address: string; blockchain: string }[] | undefined, blockchain: string): Wallet[] {
  return (ws ?? [])
    .filter((w) => w.blockchain === blockchain)
    .map((w) => ({ id: w.id, address: w.address as `0x${string}`, blockchain: w.blockchain }));
}

/** Circle SDK errors are axios errors; map auth failures to 401 without echoing tokens. */
function mapCircleError(err: unknown): never {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  if (status === 401 || status === 403) throw new HttpError(401, "invalid_user_token", "Circle session expired — sign in again.");
  if (status === 400 || status === 422) throw new HttpError(400, "circle_bad_request", "Circle rejected the request.");
  throw new HttpError(502, "circle_unavailable", "Circle is unavailable, try again.");
}

export async function createSocialDeviceToken(client: CircleUserControlledWalletsClient, deviceId: string) {
  try {
    const res = await client.createDeviceTokenForSocialLogin({ deviceId });
    const d = res.data;
    if (!d?.deviceToken) throw new HttpError(502, "circle_unavailable", "Circle returned no device token.");
    return { deviceToken: d.deviceToken, deviceEncryptionKey: d.deviceEncryptionKey ?? "" };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    mapCircleError(e);
  }
}

/**
 * Make sure the user has an EOA wallet on Arc. Social/email users never set a PIN, so the decision
 * is based on wallets, not pinStatus:
 *  - already has an Arc wallet → challengeId = null
 *  - user not initialized yet → `/user/initialize` challenge (creates the Arc wallet)
 *  - initialized but no Arc wallet (e.g. created on another chain) → wallet-creation challenge
 * Wallet creation finishes asynchronously after the client executes the challenge.
 */
export async function initializeUser(
  client: CircleUserControlledWalletsClient,
  userToken: string,
  chainKey: ChainKey,
): Promise<CircleInitializeResponse> {
  const blockchain = circleBlockchain(chainKey);
  try {
    const list = await client.listWallets({ userToken, blockchain });
    const wallets = mapWallets(list.data?.wallets, blockchain);
    if (wallets.length > 0) return { challengeId: null, wallets };
    try {
      const r = await client.createUserPinWithWallets({ userToken, blockchains: [blockchain], accountType: "EOA" });
      return { challengeId: r.data?.challengeId ?? null, wallets: [] };
    } catch (e) {
      if (!isAlreadyInitialized(e)) throw e;
    }
    const r = await client.createWallet({ userToken, blockchains: [blockchain], accountType: "EOA" });
    return { challengeId: r.data?.challengeId ?? null, wallets: [] };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    mapCircleError(e);
  }
}

/** Circle error 155106: "User has already been initialized." */
export function isAlreadyInitialized(err: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (err as any)?.response?.data ?? (err as any)?.data;
  const code = Number(data?.code ?? (err as { code?: unknown })?.code);
  const message = String(data?.message ?? (err as Error)?.message ?? "");
  return code === 155106 || /already (been )?initiali[sz]ed/i.test(message);
}

/** Wallets on the active Arc network plus USDC/EURC balances read onchain (6-dp base units). */
export async function listUserWallets(
  client: CircleUserControlledWalletsClient,
  publicClient: PublicClient,
  userToken: string,
  chainKey: ChainKey,
): Promise<CircleWalletsResponse> {
  const blockchain = circleBlockchain(chainKey);
  let wallets: Wallet[];
  try {
    const list = await client.listWallets({ userToken, blockchain });
    wallets = mapWallets(list.data?.wallets, blockchain);
  } catch (e) {
    mapCircleError(e);
  }
  const { USDC, EURC } = TOKENS[chainKey];
  const balances: CircleWalletsResponse["balances"] = {};
  await Promise.all(
    wallets.map(async (w) => {
      const read = (token: `0x${string}`) =>
        publicClient
          .readContract({ address: token, abi: erc20PermitAbi, functionName: "balanceOf", args: [w.address] })
          .then((v) => v.toString());
      const [usdc, eurc] = await Promise.all([read(USDC), read(EURC)]);
      balances[w.address] = { USDC: usdc, EURC: eurc };
    }),
  );
  return { wallets, balances };
}
