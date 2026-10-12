#!/usr/bin/env -S npx tsx
/**
 * clippool-verify — recompute a ClipPool payout split from a published snapshot.
 *
 *   verify <snapshot.json> [--rpc URL --address 0xClipPool]
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 usage / input error.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { verifySnapshot } from "./verify";

export const CLIPPOOL_GET_CAMPAIGN_ABI = parseAbi([
  "function getCampaign(uint256 id) view returns ((address brand,address token,uint128 pool,uint128 totalAllocated,uint128 claimed,uint64 startTime,uint64 endTime,uint64 snapshotTime,uint64 rootPostedAt,uint16 maxShareBps,uint32 minViews,bytes32 rulesHash,bytes32 root,bytes32 snapshotHash,bool remainderRefunded,bool unclaimedSwept))",
]);

export interface OnchainCampaign {
  pool: bigint;
  totalAllocated: bigint;
  maxShareBps: number;
  minViews: number;
  root: Hex;
  snapshotHash: Hex;
}

export type ReadCampaign = (rpc: string, address: Address, id: bigint) => Promise<OnchainCampaign>;

export const readCampaignViaRpc: ReadCampaign = async (rpc, address, id) => {
  const client = createPublicClient({ transport: http(rpc) });
  const c = await client.readContract({
    address,
    abi: CLIPPOOL_GET_CAMPAIGN_ABI,
    functionName: "getCampaign",
    args: [id],
  });
  return {
    pool: c.pool,
    totalAllocated: c.totalAllocated,
    maxShareBps: c.maxShareBps,
    minViews: c.minViews,
    root: c.root,
    snapshotHash: c.snapshotHash,
  };
};

export interface CliIO {
  log: (line: string) => void;
  error: (line: string) => void;
  readFile: (path: string) => string;
  readCampaign: ReadCampaign;
}

const defaultIO: CliIO = {
  log: (l) => console.log(l),
  error: (l) => console.error(l),
  readFile: (p) => readFileSync(resolve(p), "utf8"),
  readCampaign: readCampaignViaRpc,
};

const USAGE = "usage: verify <snapshot.json> [--rpc URL --address 0xClipPool]";

export async function runCli(argv: string[], io: Partial<CliIO> = {}): Promise<number> {
  const { log, error, readFile, readCampaign } = { ...defaultIO, ...io };
  const args = argv.filter((a) => a !== "--");
  if (args[0] === "verify") args.shift();

  let file: string | undefined;
  let rpc: string | undefined;
  let address: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--rpc") rpc = args[++i];
    else if (a === "--address") address = args[++i];
    else if (a === "-h" || a === "--help") {
      log(USAGE);
      return 0;
    } else if (!file && !a.startsWith("--")) file = a;
    else {
      error(`unexpected argument: ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!file) {
    error(USAGE);
    return 2;
  }
  if ((rpc === undefined) !== (address === undefined)) {
    error(`--rpc and --address must be given together\n${USAGE}`);
    return 2;
  }
  if (address !== undefined && !isAddress(address, { strict: false })) {
    error(`invalid --address ${address}`);
    return 2;
  }

  let report;
  try {
    report = verifySnapshot(JSON.parse(readFile(file)));
  } catch (e) {
    error(`could not verify ${file}: ${(e as Error).message}`);
    return 2;
  }

  const c = report.computed;
  const differences = [...report.differences];
  log(`snapshot:        ${file}`);
  log(`campaign:        ${c.campaignId}`);
  log(`allocations:     ${c.allocations}`);
  log(`totalAllocated:  ${c.totalAllocated}`);
  log(`leftover:        ${c.leftover}`);
  log(`recomputed root: ${c.root}`);
  log(`snapshotHash:    ${c.snapshotHash}`);
  for (const w of report.warnings) log(`warning: ${w}`);

  if (rpc && address) {
    try {
      const onchain = await readCampaign(rpc, address as Address, c.campaignId);
      log(`onchain root:    ${onchain.root}`);
      log(`onchain hash:    ${onchain.snapshotHash}`);
      if (onchain.root.toLowerCase() !== c.root.toLowerCase()) {
        differences.push(`onchain root ${onchain.root} != recomputed ${c.root}`);
      }
      if (onchain.totalAllocated !== c.totalAllocated) {
        differences.push(`onchain totalAllocated ${onchain.totalAllocated} != recomputed ${c.totalAllocated}`);
      }
      if (onchain.snapshotHash.toLowerCase() !== c.snapshotHash.toLowerCase()) {
        differences.push(`onchain snapshotHash ${onchain.snapshotHash} != keccak256(canonical snapshot) ${c.snapshotHash}`);
      }
    } catch (e) {
      differences.push(`onchain read failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  if (differences.length === 0) {
    log(rpc ? "PASS — snapshot recomputes to its root, which matches the onchain root" : "PASS — snapshot recomputes to its root");
    return 0;
  }
  log(`FAIL — ${differences.length} difference(s):`);
  for (const d of differences) log(`  - ${d}`);
  return 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
