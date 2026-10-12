// End-to-end ClipPool run on Arc TESTNET with real (testnet) USDC — no YouTube/DB involved:
//   brand funds a campaign with EIP-2612 permit → oracle posts the root of a synthetic snapshot →
//   keeper pushes payouts with claimMany → brand reclaims the remainder → everything verified onchain.
// Usage (from apps/web): pnpm e2e:testnet            start a new run (resumes an unfinished one)
//                         pnpm e2e:testnet --fresh    ignore saved state and start over
// State is saved to apps/web/.e2e/state.json so the run survives interruptions.
import fs from "node:fs";
import path from "node:path";
import { buildSnapshot, snapshotHash, verifySnapshot, type SnapshotDocument, type Submission } from "@clippool/allocation";
import { decodeEventLog, keccak256, parseSignature, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { clipPoolAbi, erc20PermitAbi } from "../lib/shared/abi";
import { assertTestnet, clients, fees, readDeployment, txUrl, usd, USDC, waitForChainTime } from "./lib";

const POOL = 3_000_000n; // 3 USDC
const MAX_SHARE_BPS = 5_000; // 50% cap → exercises the water-filling
const MIN_VIEWS = 1_000n;
const STATE_DIR = path.resolve(process.cwd(), ".e2e");
const STATE_FILE = path.join(STATE_DIR, "state.json");

interface State {
  clipPool: Address;
  campaignId: string;
  createTx: Hex;
  snapshotTime: string;
  snapshot: SnapshotDocument;
  snapshotHash: Hex;
  postRootTx?: Hex;
  claimTx?: Hex;
  refundTx?: Hex;
}

const save = (s: State) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
};
const load = (): State | null => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null);
const step = (msg: string) => console.log(`\n▶ ${msg}`);
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

async function main() {
  const { publicClient, wallet } = clients();
  await assertTestnet(publicClient);
  const { address: clipPool } = readDeployment();
  const brand = wallet("TEST_BRAND_PRIVATE_KEY");
  const oracle = wallet("ORACLE_PRIVATE_KEY");
  const keeper = wallet("KEEPER_PRIVATE_KEY");
  const creators = [
    privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address,
    oracle.account.address,
    keeper.account.address,
  ];
  const read = <T>(functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: clipPool, abi: clipPoolAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  const disputeWindow = await read<bigint>("DISPUTE_WINDOW");
  const minDelay = await read<bigint>("MIN_MEASUREMENT_DELAY"); // no fallback: a wrong delay silently stretches the run
  console.log(`ClipPool ${clipPool} · dispute window ${disputeWindow}s · min measurement delay ${minDelay}s`);
  if (disputeWindow > 3600n) console.log("  ⚠ long dispute window — this run will take a while (testnet deploys should use 10 min)");

  let state = process.argv.includes("--fresh") ? null : load();
  if (state && state.clipPool.toLowerCase() !== clipPool.toLowerCase()) state = null;

  // ── 1. brand creates + funds the campaign with a permit ──
  if (!state) {
    step("Brand creates a 3 USDC campaign (EIP-2612 permit, one transaction)");
    const bal = await publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "balanceOf", args: [brand.account.address] });
    if (bal < POOL) throw new Error(`Brand ${brand.account.address} has ${usd(bal)}; needs ${usd(POOL)} + gas. Run pnpm fund:testnet --send`);
    const [name, version, nonce] = await Promise.all([
      publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "name" }),
      publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "version" }),
      publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "nonces", args: [brand.account.address] }),
    ]);
    const now = (await publicClient.getBlock()).timestamp;
    const params = {
      token: USDC,
      pool: POOL,
      startTime: now,
      endTime: now + 60n,
      measurementDelay: minDelay,
      maxShareBps: MAX_SHARE_BPS,
      minViews: Number(MIN_VIEWS),
      rulesHash: keccak256(toBytes("ClipPool testnet E2E — synthetic submissions")),
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
      message: { owner: brand.account.address, spender: clipPool, value: POOL, nonce, deadline },
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
    if (receipt.status !== "success") throw new Error(`create reverted: ${txUrl(createTx)}`);
    const created = receipt.logs
      .filter((l) => l.address.toLowerCase() === clipPool.toLowerCase())
      .map((l) => { try { return decodeEventLog({ abi: clipPoolAbi, ...l }); } catch { return null; } })
      .find((e) => e?.eventName === "CampaignCreated");
    if (!created) throw new Error("CampaignCreated not found in receipt");
    const { id, snapshotTime } = created.args as { id: bigint; snapshotTime: bigint };
    ok(`campaign #${id} created · ${txUrl(createTx)}`);

    // synthetic snapshot (what the oracle would compute from YouTube views)
    const submissions: Submission[] = [
      { videoId: "e2eVideo001", channelId: "UCe2eChannel000000000001", wallet: creators[0], views: 150_000n },
      { videoId: "e2eVideo002", channelId: "UCe2eChannel000000000002", wallet: creators[1], views: 90_000n },
      { videoId: "e2eVideo003", channelId: "UCe2eChannel000000000003", wallet: creators[2], views: 30_000n },
      { videoId: "e2eVideo004", channelId: "UCe2eChannel000000000003", wallet: creators[2], views: 500n }, // below minViews
    ];
    const snapshot = buildSnapshot({ id, pool: POOL, maxShareBps: MAX_SHARE_BPS, minViews: MIN_VIEWS }, submissions);
    state = { clipPool, campaignId: id.toString(), createTx, snapshotTime: snapshotTime.toString(), snapshot, snapshotHash: snapshotHash(snapshot) };
    save(state);
  } else {
    console.log(`Resuming campaign #${state.campaignId} from .e2e/state.json`);
  }

  const id = BigInt(state.campaignId);
  const report = verifySnapshot(state.snapshot);
  if (!report.ok) throw new Error(`snapshot self-check failed: ${report.differences.join("; ")}`);
  console.log("  allocation:", state.snapshot.allocations.map((a) => `${a.wallet.slice(0, 8)}… ${usd(BigInt(a.amount))}`).join(" · "), `· leftover ${usd(BigInt(state.snapshot.leftover))}`);

  // ── 2. oracle posts the root after the snapshot time ──
  let campaign = await read<{ rootPostedAt: bigint; root: Hex }>("getCampaign", [id]);
  if (campaign.rootPostedAt === 0n) {
    step("Waiting for the measurement window, then the oracle posts the Merkle root");
    await waitForChainTime(publicClient, BigInt(state.snapshotTime) + 2n, "snapshot time");
    const { request } = await publicClient.simulateContract({
      ...(await fees(publicClient)),
      account: oracle.account, address: clipPool, abi: clipPoolAbi, functionName: "postRoot",
      args: [id, state.snapshot.root, BigInt(state.snapshot.totalAllocated), state.snapshotHash],
    });
    const hash = await oracle.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    state.postRootTx = hash;
    save(state);
    ok(`root ${state.snapshot.root.slice(0, 10)}… posted · ${txUrl(hash)}`);
    campaign = await read("getCampaign", [id]);
  }
  if (campaign.root.toLowerCase() !== state.snapshot.root.toLowerCase()) throw new Error("onchain root ≠ snapshot root");

  // ── 3. keeper pushes payouts after the dispute window ──
  const pending = [];
  for (const p of state.snapshot.proofs) if (!(await read<boolean>("isClaimed", [id, p.wallet]))) pending.push(p);
  const before = new Map<string, bigint>();
  if (pending.length) {
    step(`Waiting for the dispute window, then the keeper pays ${pending.length} creators in one claimMany`);
    await waitForChainTime(publicClient, campaign.rootPostedAt + disputeWindow + 2n, "dispute window");
    for (const p of pending) before.set(p.wallet, await publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "balanceOf", args: [p.wallet as Address] }));
    const claims = pending.map((p) => ({ account: p.wallet as Address, amount: BigInt(p.amount), proof: p.proof }));
    const { request, result } = await publicClient.simulateContract({ ...(await fees(publicClient)), account: keeper.account, address: clipPool, abi: clipPoolAbi, functionName: "claimMany", args: [id, claims] });
    if (result !== BigInt(claims.length)) throw new Error(`simulation: only ${result}/${claims.length} claims would succeed`);
    const hash = await keeper.writeContract(request);
    const claimReceipt = await publicClient.waitForTransactionReceipt({ hash });
    state.claimTx = hash;
    save(state);
    ok(`payouts sent · ${txUrl(hash)}`);
    // The keeper pays gas from the same USDC balance (18-dp native → 6-dp ERC-20 view).
    const gasPaid6 = (claimReceipt.gasUsed * claimReceipt.effectiveGasPrice) / 10n ** 12n;
    for (const p of pending) {
      const after = await publicClient.readContract({ address: USDC, abi: erc20PermitAbi, functionName: "balanceOf", args: [p.wallet as Address] });
      const isSender = p.wallet.toLowerCase() === keeper.account.address.toLowerCase();
      const got = after - (before.get(p.wallet) ?? 0n) + (isSender ? gasPaid6 : 0n);
      if (got !== BigInt(p.amount)) throw new Error(`${p.wallet} received ${usd(got)}, expected ${usd(BigInt(p.amount))}`);
      ok(`${p.wallet} +${usd(got)} (matches allocation)`);
    }
  }

  // ── 4. brand reclaims the leftover ──
  campaign = await read("getCampaign", [id]);
  if (!(campaign as unknown as { remainderRefunded: boolean }).remainderRefunded) {
    step(`Brand reclaims the remainder (${usd(BigInt(state.snapshot.leftover))})`);
    const { request } = await publicClient.simulateContract({ ...(await fees(publicClient)), account: brand.account, address: clipPool, abi: clipPoolAbi, functionName: "refundRemainder", args: [id] });
    const hash = await brand.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    state.refundTx = hash;
    save(state);
    ok(`remainder refunded · ${txUrl(hash)}`);
  }

  // ── 5. final invariants ──
  const final = await read<{ claimed: bigint; totalAllocated: bigint; pool: bigint }>("getCampaign", [id]);
  if (final.claimed !== final.totalAllocated) throw new Error(`claimed ${final.claimed} ≠ allocated ${final.totalAllocated}`);
  console.log(`\n✅ E2E PASSED — campaign #${id}: pool ${usd(final.pool)}, paid ${usd(final.claimed)} to ${state.snapshot.proofs.length} creators, ${usd(final.pool - final.claimed)} refunded.`);
  console.log(`   create ${txUrl(state.createTx)}\n   root   ${state.postRootTx ? txUrl(state.postRootTx) : "-"}\n   payout ${state.claimTx ? txUrl(state.claimTx) : "-"}\n   refund ${state.refundTx ? txUrl(state.refundTx) : "-"}`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
