// Shared helpers for ClipPool operator scripts (testnet only). Run from apps/web with tsx.
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const ROOT = path.resolve(process.cwd(), "../..");
loadEnv({ path: path.join(ROOT, ".env"), override: false, quiet: true });

export const TESTNET_ID = 5042002;
export const USDC: Address = "0x3600000000000000000000000000000000000000";
export const EXPLORER = "https://explorer.testnet.arc.io";
export const MIN_FEE = 20_000_000_000n; // Arc mempool floor: maxFeePerGas ≥ 20 gwei

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in root .env`);
  return v;
}

export function clients() {
  const rpc = process.env.ARC_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.arc.io";
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpc) }) as PublicClient;
  const wallet = (envKey: string) => {
    const account = privateKeyToAccount(requireEnv(envKey) as Hex);
    return createWalletClient({ account, chain: arcTestnet, transport: http(rpc) });
  };
  return { publicClient, wallet };
}

/** Refuse to run anywhere but Arc testnet. */
export async function assertTestnet(publicClient: PublicClient) {
  const id = await publicClient.getChainId();
  if (id !== TESTNET_ID) throw new Error(`Refusing to run: chain id ${id} is not Arc testnet (${TESTNET_ID})`);
}

/** EIP-1559 fees respecting Arc's 20 gwei floor. */
export async function fees(publicClient: PublicClient) {
  const est = await publicClient.estimateFeesPerGas().catch(() => null);
  const maxPriorityFeePerGas = est?.maxPriorityFeePerGas ?? 1_000_000_000n;
  let maxFeePerGas = est?.maxFeePerGas ?? MIN_FEE;
  if (maxFeePerGas < MIN_FEE + maxPriorityFeePerGas) maxFeePerGas = MIN_FEE + maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

export const usd = (base6: bigint) => `${formatUnits(base6, 6)} USDC`;
export const native = (wei: bigint) => `${formatUnits(wei, 18)} USDC`;
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

export function readDeployment(): { address: Address; deployBlock?: number } {
  const file = path.join(ROOT, "contracts", "deployments", `${TESTNET_ID}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const addr = process.env.NEXT_PUBLIC_CLIPPOOL_ADDRESS?.trim();
  if (!addr) throw new Error(`No deployment: ${file} missing and NEXT_PUBLIC_CLIPPOOL_ADDRESS empty`);
  return { address: addr as Address };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the chain's latest block timestamp ≥ target (unix seconds). */
export async function waitForChainTime(publicClient: PublicClient, target: bigint, label: string) {
  for (;;) {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    if (block.timestamp >= target) return;
    const left = Number(target - block.timestamp);
    process.stdout.write(`\r⏳ ${label}: ${Math.floor(left / 60)}m ${left % 60}s left   `);
    await sleep(Math.min(15_000, Math.max(2_000, left * 1000)));
  }
}
