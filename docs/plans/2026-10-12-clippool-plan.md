# ClipPool — Implementation Plan (v1)

Spec: [2026-10-12-clippool-spec.md](2026-10-12-clippool-spec.md) · Status: **Draft for review**

## 1. Architecture

```
 Brand wallet ──permit+create──▶ ┌──────────────┐ ◀──postRoot── Oracle signer ┐
                                 │  ClipPool    │ ◀──cancelRoot── Guardian     │
 Creator wallet ◀──USDC/EURC──── │ (Arc mainnet)│ ◀──claimMany── Keeper       │ apps/web
                                 └──────────────┘                              │ (Next.js API
 Creator ──submit URL──▶ apps/web API ──▶ Postgres ◀── cron: refresh/snapshot ─┘  + Vercel Cron)
                              │                            │
                              └──▶ YouTube Data API ◀──────┘
 Anyone ──▶ packages/allocation CLI: recompute root from published snapshot == onchain root
```

## 2. Repo layout (pnpm workspace monorepo)

```
contracts/                 Arc Foundry project
  src/ClipPool.sol
  test/ClipPool.t.sol      unit + fuzz
  test/ClipPoolFork.t.sol  fork tests against Arc mainnet (real USDC/EURC)
  test/fixtures/           golden allocation vectors (shared with TS)
  script/Deploy.s.sol
packages/allocation/       TypeScript, zero I/O
  src/allocate.ts          water-filling, bigint math
  src/tree.ts              OZ StandardMerkleTree build/verify
  src/cli.ts               `verify <snapshot.json> --campaign <id>` → compares with onchain root
  test/                    vitest + golden vectors
apps/web/                  Next.js (App Router) + viem/wagmi + Tailwind/shadcn (UI stack: §5a)
  app/                     /, /campaigns/new, /c/[id], /c/[id]/submit, /c/[id]/receipts
  app/api/submissions      POST validate+store
  app/api/cron/refresh     hourly view refresh (estimates; ≤30-day retention)
  app/api/cron/snapshot    snapshot → allocation → postRoot
  app/api/cron/keeper      push claimMany after the dispute window
  lib/youtube.ts           videos.list wrapper (≤50 ids/call)
  lib/db/                  Drizzle schema + migrations (Neon Postgres)
docs/plans/, docs/research/
TODO.md
```

## 3. Contract design — `ClipPool.sol`

- OpenZeppelin: `SafeERC20`, `MerkleProof`, `ReentrancyGuard`, `Ownable2Step`.
- Roles: `owner` (config, token allowlist), `oracle` (postRoot), `guardian` (cancelRoot).
- Constants: `ROOT_DEADLINE = 14d` after snapshotTime, `CLAIM_PERIOD = 90d`.
- Deploy-time immutables (constructor args, no setters): `DISPUTE_WINDOW()` — mainnet 48h, testnet 10 min;
  `MIN_MEASUREMENT_DELAY()` — mainnet 1h, testnet 5 min. Offchain code reads them from the contract.

```solidity
struct Campaign {
  address brand; address token;
  uint128 pool; uint128 totalAllocated; uint128 claimed;
  uint64 startTime; uint64 endTime; uint64 snapshotTime; uint64 rootPostedAt;
  uint16 maxShareBps; uint32 minViews;
  bytes32 rulesHash; bytes32 root; bytes32 snapshotHash;
  bool remainderRefunded;
}

createCampaign(token, pool, start, end, measurementDelay, maxShareBps, minViews, rulesHash) → id
createCampaignWithPermit(..., deadline, v, r, s) → id          // one-tx funding (EIP-2612)
postRoot(id, root, totalAllocated, snapshotHash)   onlyOracle   // now ≥ snapshotTime, total ≤ pool, no live root
cancelRoot(id)                                     onlyGuardian // only inside dispute window
claim(id, account, amount, proof)                               // after window, before claim deadline, once per account
claimMany(id, Claim[] calldata)                                 // per-item try/catch via external self-call; emits ClaimFailed
refundRemainder(id)                                onlyBrand    // after window: pool − totalAllocated (once)
sweepUnclaimed(id)                                 onlyBrand    // after claim deadline: totalAllocated − claimed
refundNoRoot(id)                                   onlyBrand    // no root by snapshotTime + ROOT_DEADLINE: everything left
```

- Leaf = `keccak256(bytes.concat(keccak256(abi.encode(campaignId, account, amount))))`
  (OZ StandardMerkleTree format; `campaignId` in the leaf prevents cross-campaign replay).
- Invariant: `claimed ≤ totalAllocated ≤ pool`; token balance ≥ Σ(pool − claimed − refunded) across campaigns.
- Arc specifics: token allowlist = {USDC `0x3600…0000`, EURC `0xbEf5…21c1`}; reject `address(0)` recipients; no native value paths.

## 4. Allocation engine — `packages/allocation`

- Input: `{ campaign: {id, pool, maxShareBps, minViews}, submissions: [{videoId, channelId, wallet, views}] }`.
- Steps: filter `views ≥ minViews` → aggregate per **wallet** → water-filling cap (spec §5.3,
  `interfaces.md` §2) with `bigint` floor division, wallets sorted by lowercase address → leaves →
  StandardMerkleTree.
- Output snapshot JSON: inputs, per-channel allocation, leftover, root, `scriptVersion`,
  `snapshotHash = keccak256(canonical JSON)`.
- Golden vectors (≥8 cases): single creator; all equal; one whale hits cap; everyone capped (refund);
  below-min filtered; zero valid submissions; rounding dust; multi-video channel.

## 5. Backend flows (`apps/web`)

| Flow | Trigger | Steps |
|---|---|---|
| Submit | `POST /api/submissions` | parse URL → `videos.list` → check code `keccak(id‖wallet)[0:8]` in description, publishedAt window, duration ≤180s, public, not duplicate, channel wallet lock → insert |
| Refresh estimates | hourly cron | batch `videos.list` (50/call) for active campaigns → update views (rows older than 30d refreshed or nulled) |
| Snapshot | cron, after snapshotTime | final fetch → allocate → store snapshot JSON (private bucket, 30-day TTL) → `postRoot` from oracle key |
| Keeper | cron, after dispute window | for each unclaimed leaf: `eth_call` simulate → batch `claimMany` (≈50/tx), `maxFeePerGas ≥ 20 gwei` |
| Index | on page load + cron | read events via viem (`getLogs` paged ≤10k blocks) → cache receipts |

Keys (env vars, never committed): `ORACLE_PK`, `KEEPER_PK`, `YOUTUBE_API_KEY`, `DATABASE_URL`.
Guardian = the owner's own wallet (manual cancel only).

## 5a. UI stack (all free / open source)

| Need | Library | License |
|---|---|---|
| Components (forms, tables, dialogs, progress) | shadcn/ui (Radix + Tailwind, copied into repo) | MIT |
| Creator wallet + login | **Circle user-controlled wallets** (`@circle-fin/w3s-pw-web-sdk`): Google login or email OTP → wallet on `ARC` (officially supported). Backend holds the Circle API key and issues user tokens. First 1,000 monthly active wallets free. Fallback: Privy | proprietary (free tier) |
| Brand wallet | wagmi injected connector (MetaMask/Rabby) with `arc` from `viem/chains` (viem ≥2.57); brands sign permit + create in their own wallet | MIT |
| Tables (leaderboard, receipts) | shadcn data-table on TanStack Table | MIT |
| Charts (views/share over time) | shadcn charts (Recharts) | MIT |
| Forms + validation | react-hook-form + zod (shadcn Form) | MIT |
| Icons / toasts / motion | lucide-react / sonner / motion | ISC / MIT / MIT |
| Accent effects (landing only, sparingly) | Magic UI (number ticker, animated list) | MIT |

Rule: one component system (shadcn); no MUI/Chakra mixing. Brand palette via the `brand-design`
skill → shadcn CSS variables; review with `frontend-design-guidelines` before Phase 5 sign-off.
No gas sponsorship needed: brands pay gas in the USDC they already hold; creators only receive.
Open: creator cash-out path (USDC on Arc → exchange/off-ramp) — document in creator FAQ.

## 6. Phases (each independently verifiable)

### Phase 0 — Setup
- [ ] pnpm monorepo, Arc Foundry install, Next.js scaffold, lint/format, CI (GitHub Actions: forge test + vitest + typecheck).
- [ ] **User actions:** create a YouTube Data API key (Google Cloud), Neon DB, Vercel project; create oracle/keeper wallets;
      fund the deployer/keeper with a few USDC on Arc mainnet, plus testnet USDC from faucet.circle.com.
- **Verify:** `arc-forge build`, `pnpm -r typecheck`, CI green on an empty skeleton.

### Phase 1 — Contract
- [ ] Implement `ClipPool.sol` per §3.
- [ ] Unit tests for every function, revert path, and time boundary; fuzz claims against a reference allocation; invariant test (§3).
- [ ] Fork tests on Arc mainnet: real USDC/EURC, permit flow, blocklist-like failing recipient in `claimMany` (mock token).
- **Verify:** `arc-forge test` green; `arc-forge coverage` ≥ 95% lines on `ClipPool.sol`.

### Phase 2 — Allocation engine
- [ ] `allocate.ts`, `tree.ts`, `cli.ts` + golden vectors in `contracts/test/fixtures`.
- [ ] Solidity test consumes the same fixtures: roots match, and every proof claims successfully.
- **Verify:** vitest green; cross-language root equality test green.

### Phase 3 — Testnet E2E (scripted, no UI)
- [ ] Deploy to Arc testnet; script: create campaign → fake snapshot fixture → postRoot → warp/wait → claimMany → refunds.
- **Verify:** all transactions visible on `explorer.testnet.arc.io`; balances match the snapshot exactly.

### Phase 4 — Backend
- [ ] DB schema (campaigns cache, submissions, channel_wallets, snapshots, claims).
- [ ] YouTube client + submission validation (tested against real public Shorts, read-only).
- [ ] Cron routes: refresh, snapshot (+ postRoot), keeper.
- **Verify:** integration test against testnet with real Shorts; a manual run produces a root that `cli verify` confirms.

### Phase 5 — Frontend
- [ ] Brand: create campaign (permit, token picker USDC/EURC, rules editor) → campaign page.
- [ ] Campaign page: pool, rules, countdown, live estimated leaderboard, submit CTA.
- [ ] Creator submit: wallet → binding code → paste URL → status.
- [ ] Receipts: per-creator allocation + claim transaction link; "verify this split" instructions.
- **Verify:** run in the browser preview against testnet: full flow with 2 wallets; no console errors; mobile layout checked.

### Phase 6 — Mainnet + pilot
- [ ] Deploy and verify on `explorer.arc.io`; set oracle/guardian; allowlist USDC + EURC.
- [ ] Pilot campaign: small self-funded pool (e.g. 20–50 USDC), short measurement delay, ≥3 real creators.
- **Verify:** pilot payouts land; `cli verify` matches the onchain root; receipts page live.

### Phase 7 — Submission package
- [ ] README (what, why Arc, trust model, how to verify), architecture diagram, demo video.
- [ ] DoraHacks submission: live URL + repo + description + builder profile *(user submits)*.

## 7. Testing strategy
- Contract: unit + fuzz + invariant + Arc mainnet fork.
- Allocation: golden vectors shared between TS and Solidity (single source of truth).
- Backend: YouTube client mocked in unit tests; one live read-only smoke test.
- E2E: scripted testnet run (Phase 3) + browser verification (Phase 5).

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Bot/fake views | per-creator cap, `minViews`, channel age ≥30d check (`channels.list`), brand flag before snapshot; v2 engaged views via zkTLS |
| Oracle key compromise | dispute window + guardian cancel; `totalAllocated ≤ pool` enforced; separate oracle/keeper keys |
| YouTube policy (30-day stats) | no stats onchain; snapshot TTL 30 days; revisit with OAuth/zkTLS in v2 |
| Blocklisted recipient | per-item isolation in `claimMany` + simulation; unclaimed swept to brand after 90d |
| Two-sided cold start | pilot with Arc ecosystem projects as first brands; we fund the first pool |
| YouTube quota | 1 unit per 50 videos; 10k/day default is ample for v1 |

## 9. Later (v2+)
zkTLS (Reclaim) engaged-view proofs · TikTok/Instagram · likes/watch-time weighting ·
per-video measurement windows · CPM-then-pro-rata hybrid · platform fee · agent-run clipping accounts (ERC-8004).
