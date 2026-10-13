# DoraHacks submission — Arc Microgrants (draft)

Submit at https://dorahacks.io/hackathon/arc-microgrants/detail → **Submit Build**. Copy each block into the form.
Fill every `⟨…⟩` before submitting. Requirements recap: live deployment on **Arc mainnet** with a link we can open,
public repo, short description of what it does + what it uses Arc for, public builder profile.

## Pre-submit checklist
- [x] ClipPool deployed **and verified** on Arc mainnet → 0xDb224b1b1dA608d51d5D6D5C492d083c80F2Dfb9
- [ ] App live at a public URL pointing at mainnet → https://clippool.vercel.app (live on testnet now; switch via docs/runbooks/mainnet.md §6)
- [x] Public GitHub repo → https://github.com/lazydevpro/clippool
- [x] Demo video (2:30) → https://youtu.be/6AJOfA3wmtU
- [ ] One real mainnet pilot campaign (small pool) with at least one payout → ⟨campaign URL + payout tx⟩
- [ ] Builder profile (GitHub / X / Farcaster) → ⟨link⟩

---

## BUIDL name
ClipPool

## Tagline (one line)
Get paid for every view, fairly — pro-rata creator campaigns paid instantly in USDC on Arc.

## Tags
Arc · USDC · EURC · Creator economy · Payouts · Payments

## Links
- **Live app (Arc mainnet):** ⟨https://…⟩
- **ClipPool contract (Arc mainnet, verified):** https://explorer.arc.io/address/0xDb224b1b1dA608d51d5D6D5C492d083c80F2Dfb9
- **Repo:** https://github.com/lazydevpro/clippool
- **Demo video:** https://youtu.be/6AJOfA3wmtU
- **Testnet deployment (verified):** https://explorer.testnet.arc.io/address/0x50519affe82591afd402c7f22ad9bc6dd2d86030

## Description

**What it does**

ClipPool lets a brand fund a creator campaign with a fixed USDC (or EURC) pool on Arc. Creators post YouTube Shorts for
the campaign; when it ends, the pool is split **pro-rata by views** — with a per-creator cap — and every creator is paid
in USDC automatically, final in under a second.

It fixes three problems with today's pay-per-view "clipping" platforms (a market that already pays creators millions):
fixed-CPM budgets run out first-come-first-served, payouts are opaque and Stripe-bound, and brands save money by
rejecting creators. With an onchain pro-rata pool, the budget is always fully and fairly spent, the brand can't claw it
back, and rejecting a creator only redistributes their share to the others.

**How it works**

1. The brand creates and funds a campaign in **one transaction** (EIP-2612 permit on Arc's native USDC/EURC); the
   rules are pinned onchain by hash.
2. Creators **Connect YouTube** (read-only OAuth proves channel ownership) — or add a per-campaign binding code — and
   submit Shorts with no gas. No crypto wallet? They get one on Arc with Google sign-in via **Circle user-controlled
   wallets**.
3. After the window, an oracle snapshots views, runs a deterministic water-filling allocation, and posts the
   **Merkle root** of payouts. Anyone can recompute it with the open-source CLI during the dispute window.
4. A keeper pushes every payout in one `claimMany`; a single bad recipient can't block the batch.

**What it uses Arc for**

- **USDC as gas + stable ~$0.001 fees** — paying hundreds of creators a few cents each is economical, and brands pay
  gas in the USDC they already hold.
- **Sub-second deterministic finality** — payouts are final instantly; creators see money, not "pending".
- **Native USDC & EURC with EIP-2612** — one-tx funding, EUR-denominated campaigns.
- **Circle user-controlled wallets on ARC** — wallet onboarding for non-crypto creators.
- **Arc Foundry** — fork tests against real Arc state (USDC permit, 6-dp ERC-20 vs 18-dp native balance, blocklist
  precompile).

**Technical credibility**

- `ClipPool.sol`: 100% line/branch coverage — unit, fuzz, invariant, cross-language golden-fixture and Arc fork
  tests (testnet + mainnet state). Deploy-time immutable dispute window (48h mainnet).
- Allocation engine (TypeScript, bigint-only): 565 tests incl. 500 randomized invariant cases; the same 10 golden
  fixtures are verified in Solidity.
- End-to-end on Arc testnet (campaign #1): permit-funded create
  ([tx](https://explorer.testnet.arc.io/tx/0xfba23fc5041e2911bf8cadf470655c5fb4d83fabb468079426fbfc6b9dc56171)) →
  oracle root ([tx](https://explorer.testnet.arc.io/tx/0xc7cc27b40f95c18e1d0fd5847465a2bc2adee20ac437369b2fbfcbdde3640839)) →
  3 creators paid in one `claimMany` ([tx](https://explorer.testnet.arc.io/tx/0xad0094b7db7ca372b15d5a0d2e65f6ce7797495475701bb9a4ffbb924ace00d7),
  191,640 gas ≈ 0.0048 USDC total) → refund ([tx](https://explorer.testnet.arc.io/tx/0xa89ae7242e40c2157cebf3a97aad6abf1c24c56651f126a58b59a5eb08a72fd5));
  the public `verify` CLI recomputes the onchain root: PASS.
- Full-stack run on testnet (campaign #2): a real YouTube Short (accepted via ownership proof) → oracle job snapshotted
  its views and posted the root ([tx](https://explorer.testnet.arc.io/tx/0x1a808104c00ab00a2d2adcae2ac4f348d17b733a5c92e294eceec2f0b3522431))
  → keeper job paid the creator's Circle wallet 2 USDC ([tx](https://explorer.testnet.arc.io/tx/0x602964b8a297288002ad51516c9c370d973d78d287a2105527d9ad07d3a97a34)).
- YouTube API compliance: no raw statistics onchain; stats purged within 30 days.

**Why it's worth taking further**

Clipping/UGC performance campaigns are a proven, growing market paid through closed Web2 rails. ClipPool turns them
into transparent, global, instant USDC payouts — a natural Arc use case (cross-border payouts) with a path to
engaged-view verification (creator-authorized YouTube Analytics, zkTLS), more platforms (TikTok, Reels), and Arc
ecosystem brands as first customers.

## Team
⟨Your name / handle⟩ — solo builder. ⟨GitHub / X / Farcaster link⟩

## Demo video outline (2–3 min)
1. 0:00 Problem: pay-per-view budgets run out; opaque payouts (15s).
2. 0:15 Brand launches a campaign → one permit tx on Arc mainnet (30s).
3. 0:45 Creator: Connect YouTube → pick Short → submitted (30s).
4. 1:15 Leaderboard live estimates → snapshot → root onchain → verify CLI PASS (30s).
5. 1:45 Payout: claimMany lands, creator wallet balance updates, explorer link (30s).
6. 2:15 Why Arc + what's next (15s).
