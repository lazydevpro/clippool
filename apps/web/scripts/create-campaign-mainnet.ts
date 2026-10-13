// Create a REAL ClipPool campaign on Arc MAINNET from the DEPLOYER wallet (.env.mainnet).
// YOU run this — it locks real USDC. Prints every setting and asks you to type CREATE first.
// Usage (from apps/web): pnpm campaign:mainnet [--title "…"] [--pool 5] [--days 7] [--delay-hours 24] [--cap 50] [--min-views 50]
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, decodeEventLog, formatUnits, http, keccak256, parseSignature, parseUnits, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc } from "viem/chains";
import { clipPoolAbi, erc20PermitAbi } from "../lib/shared/abi";

const ROOT = path.resolve(process.cwd(), "../..");
const env = loadEnv({ path: path.join(ROOT, ".env.mainnet"), processEnv: {}, quiet: true }).parsed ?? {};
const USDC: Address = "0x3600000000000000000000000000000000000000";
const APP = "https://clippool.fun";
const MIN_FEE = 20_000_000_000n;

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const usd = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const when = (t: bigint) => new Date(Number(t) * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

async function main() {
  const title = arg("title", "ClipPool Launch Week: get paid per view on Arc");
  const pool = parseUnits(arg("pool", "5"), 6);
  const days = Number(arg("days", "7"));
  const delayHours = Number(arg("delay-hours", "24"));
  const capPct = Number(arg("cap", "50"));
  const minViews = Number(arg("min-views", "50"));
  const rules = [
    "Make a YouTube Short (max 3 minutes) about ClipPool or Arc: how creators get paid per view, USDC payouts on Arc, or your take on fair creator pay.",
    "",
    "What qualifies",
    "• Public Short, published while submissions are open. Original content only.",
    "• Prove the channel is yours: Connect YouTube on clippool.fun (read-only), or add your binding code to the description.",
    "• Disclose the sponsorship: #ad or YouTube's \"includes paid promotion\" label.",
    "",
    "How you get paid",
    `• The pool is split by each creator's views at the snapshot, ${delayHours}h after submissions close.`,
    `• One creator can earn at most ${capPct}% of the pool; the rest goes to the other creators.`,
    `• Shorts with fewer than ${minViews} views at the snapshot don't count.`,
    "• Paid automatically in USDC on Arc mainnet after the 48-hour review window. No claiming.",
  ].join("\n");

  const pk = env.DEPLOYER_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env.mainnet");
  const rpc = env.ARC_MAINNET_RPC_URL?.trim() || "https://rpc.mainnet.arc.io";
  const publicClient = createPublicClient({ chain: arc, transport: http(rpc) });
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http(rpc) });
  if ((await publicClient.getChainId()) !== 5042) throw new Error("RPC is not Arc mainnet");
  const { address: clipPool } = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/deployments/5042.json"), "utf8")) as { address: Address };

  const [bal, minDelay, name, version, nonce, now] = await Promise.all([
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: clipPool, abi: clipPoolAbi, functionName: "MIN_MEASUREMENT_DELAY" }) as Promise<bigint>,
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "name" }),
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "version" }),
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "nonces", args: [account.address] }),
    publicClient.getBlock().then((b) => b.timestamp),
  ]);
  const delay = BigInt(Math.round(delayHours * 3600));
  if (delay < minDelay) throw new Error(`delay must be ≥ ${minDelay}s on mainnet`);
  const start = now;
  const end = now + BigInt(Math.round(days * 86400));
  const snapshot = end + delay;
  const params = { token: USDC, pool, startTime: start, endTime: end, measurementDelay: delay, maxShareBps: Math.round(capPct * 100), minViews, rulesHash: keccak256(toBytes(rules)) };

  console.log(`\nClipPool ${clipPool} · Arc MAINNET\n`);
  console.log(`Title        ${title}`);
  console.log(`Brand        ${account.address} (balance ${usd(bal)})`);
  console.log(`Pool         ${usd(pool)}  · cap ${capPct}% (${usd((pool * BigInt(params.maxShareBps)) / 10000n)}) · min views ${minViews}`);
  console.log(`Opens        ${when(start)} (now)`);
  console.log(`Closes       ${when(end)}  (${days} days)`);
  console.log(`Snapshot     ${when(snapshot)}  (+${delayHours}h)`);
  console.log(`Payout       ≈ ${when(snapshot + 48n * 3600n)}  (after the 48h review window)`);
  console.log(`\nRules:\n${rules}\n`);
  if (bal < pool) throw new Error(`Brand needs ${usd(pool)} + gas`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type CREATE to lock ${usd(pool)} on Arc mainnet: `).catch(() => "");
  rl.close();
  if (answer.trim() !== "CREATE") return console.log("aborted — nothing sent");

  const deadline = now + 3600n;
  const sig = await wallet.signTypedData({
    domain: { name, version, chainId: 5042, verifyingContract: USDC },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: account.address, spender: clipPool, value: pool, nonce, deadline },
  });
  const { v, r, s } = parseSignature(sig);
  const est = await publicClient.estimateFeesPerGas().catch(() => null);
  const maxPriorityFeePerGas = est?.maxPriorityFeePerGas ?? 1_000_000_000n;
  const maxFeePerGas = (est?.maxFeePerGas ?? MIN_FEE) < MIN_FEE + maxPriorityFeePerGas ? MIN_FEE + maxPriorityFeePerGas : est!.maxFeePerGas;
  const { request } = await publicClient.simulateContract({ account, address: clipPool, abi: clipPoolAbi, functionName: "createCampaignWithPermit", args: [params, deadline, Number(v), r, s], maxFeePerGas, maxPriorityFeePerGas });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const ev = receipt.logs.map((l) => { try { return decodeEventLog({ abi: clipPoolAbi, ...l }); } catch { return null; } }).find((e) => e?.eventName === "CampaignCreated");
  if (receipt.status !== "success" || !ev) throw new Error(`create failed: https://explorer.arc.io/tx/${hash}`);
  const id = (ev.args as { id: bigint }).id;
  console.log(`✓ campaign #${id} created · https://explorer.arc.io/tx/${hash}`);

  const res = await fetch(`${APP}/api/campaigns/${id}/meta`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, rules, createTx: hash }) });
  console.log(res.ok ? "✓ title + rules published" : `⚠ meta POST: HTTP ${res.status} ${await res.text()}`);
  console.log(`→ ${APP}/c/${id}   (creators submit at ${APP}/c/${id}/submit)`);
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
