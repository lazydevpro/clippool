// Create a ClipPool campaign on Arc TESTNET from the TEST_BRAND wallet (permit, one tx),
// then attach title + rules via POST /api/campaigns/:id/meta on the running app.
// Usage (from apps/web): pnpm campaign:testnet --title "My test" --pool 2 --minutes 120 [--cap 100] [--min-views 1] [--app http://localhost:3000]
import { decodeEventLog, keccak256, parseSignature, parseUnits, toBytes } from "viem";
import { clipPoolAbi, erc20PermitAbi } from "../lib/shared/abi";
import { assertTestnet, clients, fees, readDeployment, txUrl, usd, USDC } from "./lib";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const title = arg("title", "ClipPool testnet pilot");
  const pool = parseUnits(arg("pool", "2"), 6);
  const minutes = BigInt(arg("minutes", "120"));
  const maxShareBps = Math.round(Number(arg("cap", "100")) * 100);
  const minViews = Number(arg("min-views", "1"));
  const app = arg("app", process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000");
  const rules = arg(
    "rules",
    [
      `${title}`,
      "",
      "• Post a public YouTube Short (≤ 3 min) during the campaign window.",
      "• Put your binding code (shown on the submit page) in the Short's description.",
      "• Payouts are split pro-rata by views at the snapshot, paid in USDC on Arc testnet.",
      "• This is a test campaign on Arc testnet — the USDC has no real value.",
    ].join("\n"),
  );

  const { publicClient, wallet } = clients();
  await assertTestnet(publicClient);
  const { address: clipPool } = readDeployment();
  const brand = wallet("TEST_BRAND_PRIVATE_KEY");
  const minDelay = (await publicClient.readContract({ address: clipPool, abi: clipPoolAbi, functionName: "MIN_MEASUREMENT_DELAY" })) as bigint;

  const bal = await publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "balanceOf", args: [brand.account.address] });
  if (bal < pool) throw new Error(`Brand has ${usd(bal)}, needs ${usd(pool)} + gas`);

  const [name, version, nonce] = await Promise.all([
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "name" }),
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "version" }),
    publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "nonces", args: [brand.account.address] }),
  ]);
  const now = (await publicClient.getBlock()).timestamp;
  const params = {
    token: USDC,
    pool,
    startTime: now,
    endTime: now + minutes * 60n,
    measurementDelay: minDelay,
    maxShareBps,
    minViews,
    rulesHash: keccak256(toBytes(rules)),
  };
  const deadline = now + 3600n;
  const sig = await brand.signTypedData({
    domain: { name, version, chainId: await publicClient.getChainId(), verifyingContract: USDC },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: brand.account.address, spender: clipPool, value: pool, nonce, deadline },
  });
  const { v, r, s } = parseSignature(sig);
  const { request } = await publicClient.simulateContract({
    ...(await fees(publicClient)),
    account: brand.account,
    address: clipPool,
    abi: clipPoolAbi,
    functionName: "createCampaignWithPermit",
    args: [params, deadline, Number(v), r, s],
  });
  const createTx = await brand.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  const created = receipt.logs
    .map((l) => { try { return decodeEventLog({ abi: clipPoolAbi, ...l }); } catch { return null; } })
    .find((e) => e?.eventName === "CampaignCreated");
  if (!created) throw new Error("CampaignCreated not found");
  const id = (created.args as { id: bigint }).id;
  console.log(`✓ campaign #${id} created (${usd(pool)}, ${minutes} min window) · ${txUrl(createTx)}`);

  const res = await fetch(`${app}/api/campaigns/${id}/meta`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, rules, createTx }),
  });
  console.log(res.ok ? `✓ title + rules attached` : `⚠ meta POST failed: HTTP ${res.status} ${await res.text()}`);
  console.log(`→ ${app}/c/${id}   submit: ${app}/c/${id}/submit`);
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
