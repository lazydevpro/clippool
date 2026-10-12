import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { runCli, type OnchainCampaign } from "../src/cli";
import {
  buildSnapshot,
  canonicalize,
  snapshotHash,
  verifySnapshot,
  type SnapshotDocument,
  type Submission,
} from "../src/index";
import { EXAMPLES_DIR, fixtureCases } from "../scripts/fixture-cases";

const EXAMPLE = resolve(EXAMPLES_DIR, "whale-capped.snapshot.json");
const example = () => JSON.parse(readFileSync(EXAMPLE, "utf8")) as SnapshotDocument;

describe("canonicalize", () => {
  it("sorts keys recursively, no whitespace, bigints as decimal strings", () => {
    expect(canonicalize({ b: 1, a: { d: [3n, "x", null, true], c: 2n }, z: undefined })).toBe(
      '{"a":{"c":"2","d":["3","x",null,true]},"b":1}',
    );
  });

  it("is independent of key insertion order", () => {
    const x = { inputs: { campaign: { id: "1", pool: "2" }, submissions: [] }, root: "0x00" };
    const y = { root: "0x00", inputs: { submissions: [], campaign: { pool: "2", id: "1" } } };
    expect(canonicalize(x)).toBe(canonicalize(y));
    expect(snapshotHash(x)).toBe(snapshotHash(y));
  });

  it("escapes strings like JSON and hashes UTF-8 bytes", () => {
    const v = { s: 'quo"te é \n' };
    expect(canonicalize(v)).toBe('{"s":"quo\\"te é \\n"}');
    expect(snapshotHash(v)).toBe(keccak256(stringToBytes('{"s":"quo\\"te é \\n"}')));
  });

  it("rejects floats and unsupported values", () => {
    expect(() => canonicalize({ x: 1.5 })).toThrow(/non-integer/);
    expect(() => canonicalize({ x: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/non-integer/);
    expect(() => canonicalize({ f: () => 1 })).toThrow(/unsupported/);
  });

  it("canonical form of the example snapshot is stable (hash pinned)", () => {
    const doc = example();
    expect(canonicalize(JSON.parse(JSON.stringify(doc)))).toBe(canonicalize(doc));
    // Pinned: if this changes, the snapshot format changed — bump SCRIPT_VERSION.
    expect(snapshotHash(doc)).toBe("0xc7e402e470518b8feb6379d13463d1c276d68f9d9d790a3edebcffae158f24f4");
  });
});

describe("buildSnapshot", () => {
  const c = fixtureCases().find((x) => x.name === "multi-video-multi-channel")!;

  it("is order-independent (same document and hash for permuted submissions)", () => {
    const a = buildSnapshot(c.campaign, c.submissions);
    const shuffled: Submission[] = [...c.submissions].reverse().map((s) => ({ ...s, wallet: s.wallet.toLowerCase() }));
    const b = buildSnapshot(c.campaign, shuffled);
    expect(b).toEqual(a);
    expect(snapshotHash(b)).toBe(snapshotHash(a));
  });

  it("contains inputs, allocations, totals, root, proofs and scriptVersion", () => {
    const s = buildSnapshot(c.campaign, c.submissions);
    expect(Object.keys(s).sort()).toEqual(
      ["allocations", "inputs", "leftover", "proofs", "root", "scriptVersion", "totalAllocated"].sort(),
    );
    expect(s.inputs.submissions).toHaveLength(c.submissions.length);
    // per-wallet aggregation: A = 40k+25k+15k, B = 30k+10k, C = 80k
    expect(s.allocations.map((a) => a.views).sort()).toEqual(["40000", "80000", "80000"]);
    expect(verifySnapshot(s).ok).toBe(true);
  });

  it("every fixture case round-trips through snapshot → verify", () => {
    for (const fc of fixtureCases()) {
      const report = verifySnapshot(JSON.parse(JSON.stringify(buildSnapshot(fc.campaign, fc.submissions))));
      expect(report.differences, fc.name).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });
});

describe("verifySnapshot", () => {
  it("passes on the example", () => {
    const r = verifySnapshot(example());
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("detects a tampered amount, root, input and proof", () => {
    const amount = example();
    amount.allocations[0]!.amount = "1";
    expect(verifySnapshot(amount).differences.join("\n")).toMatch(/amount snapshot 1 != recomputed/);

    const root = example();
    root.root = `0x${"ab".repeat(32)}`;
    expect(verifySnapshot(root).differences.join("\n")).toMatch(/^root:/);

    const input = example();
    input.inputs.submissions[0]!.views = "999999";
    const d = verifySnapshot(input);
    expect(d.ok).toBe(false);
    expect(d.differences.some((x) => x.startsWith("root:"))).toBe(true);

    const proof = example();
    proof.proofs[1]!.proof = [...proof.proofs[0]!.proof];
    expect(verifySnapshot(proof).differences.join("\n")).toMatch(/proofs: proof for/);
  });

  it("throws on malformed inputs", () => {
    expect(() => verifySnapshot({})).toThrow(/inputs/);
    const bad = example() as unknown as { inputs: { campaign: { pool: string } } };
    bad.inputs.campaign.pool = "1e9";
    expect(() => verifySnapshot(bad)).toThrow(/decimal string/);
  });
});

describe("cli", () => {
  const io = () => {
    const out: string[] = [];
    return { out, log: (l: string) => out.push(l), error: (l: string) => out.push(l) };
  };
  const doc = example();
  const onchain = (over: Partial<OnchainCampaign> = {}) => async (): Promise<OnchainCampaign> => ({
    pool: BigInt(doc.inputs.campaign.pool),
    totalAllocated: BigInt(doc.totalAllocated),
    maxShareBps: doc.inputs.campaign.maxShareBps,
    minViews: Number(doc.inputs.campaign.minViews),
    root: doc.root,
    snapshotHash: snapshotHash(doc),
    ...over,
  });

  it("PASS on the example snapshot (offline)", async () => {
    const o = io();
    expect(await runCli(["verify", EXAMPLE], o)).toBe(0);
    expect(o.out.at(-1)).toMatch(/^PASS/);
  });

  it("strips a pnpm '--' separator", async () => {
    expect(await runCli(["--", EXAMPLE], io())).toBe(0);
  });

  it("PASS against a stubbed onchain campaign", async () => {
    const o = io();
    const code = await runCli([EXAMPLE, "--rpc", "http://stub", "--address", "0x0000000000000000000000000000000000000001"], {
      ...o,
      readCampaign: onchain(),
    });
    expect(code).toBe(0);
    expect(o.out.at(-1)).toMatch(/matches the onchain root/);
  });

  it("FAIL when the onchain root or snapshotHash differs", async () => {
    const o = io();
    const code = await runCli([EXAMPLE, "--rpc", "http://stub", "--address", "0x0000000000000000000000000000000000000001"], {
      ...o,
      readCampaign: onchain({ root: `0x${"11".repeat(32)}`, snapshotHash: `0x${"22".repeat(32)}` }),
    });
    expect(code).toBe(1);
    const text = o.out.join("\n");
    expect(text).toMatch(/FAIL — 2 difference/);
    expect(text).toMatch(/onchain root 0x1111/);
    expect(text).toMatch(/onchain snapshotHash 0x2222/);
  });

  it("FAIL on a tampered file; usage errors exit 2", async () => {
    const tampered = example();
    tampered.allocations[0]!.amount = "1";
    const o = io();
    expect(await runCli(["x.json"], { ...o, readFile: () => JSON.stringify(tampered) })).toBe(1);
    expect(o.out.join("\n")).toMatch(/FAIL/);
    expect(await runCli([], io())).toBe(2);
    expect(await runCli([EXAMPLE, "--rpc", "http://x"], io())).toBe(2);
    expect(await runCli([EXAMPLE, "--rpc", "http://x", "--address", "nope"], io())).toBe(2);
    expect(await runCli(["missing.json"], { ...io(), readFile: () => { throw new Error("ENOENT"); } })).toBe(2);
  });
});
