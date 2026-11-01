# DoraHacks submission — Arc Microgrants

Submit at https://dorahacks.io/hackathon/arc-microgrants/detail → **Submit Build**. Each section below maps to a form
field — copy/paste. Assets live in `docs/assets/`.

## Pre-submit checklist
- [x] ClipPool v2 deployed **and verified** on Arc mainnet → [`0xAe32115c22ccdc7eb1654053023aCaD84050b89a`](https://explorer.arc.io/address/0xAe32115c22ccdc7eb1654053023aCaD84050b89a)
- [x] **App on mainnet** → https://clippool.fun (Arc mainnet, contract above; first sync caught up)
- [x] Public repo → https://github.com/lazydevpro/clippool
- [x] Demo video → https://youtu.be/6AJOfA3wmtU
- [ ] Builder profile link (GitHub `https://github.com/lazydevpro` and/or X / Farcaster)
- [ ] License chosen (recommend MIT) — repo currently says "TBD"
- [x] Mainnet launch campaign live → https://clippool.fun/c/1 (5 USDC escrowed, scored by likes, brand approval; [tx](https://explorer.arc.io/tx/0x02b5f67c308d4aac68b6d11ec8b303bb66088b65ef64b0eb3390cb99b6c1e7a1))

---

## BUIDL name
```
ClipPool
```

## Logo
`docs/assets/logo-1024.png` (square, 1024×1024). Smaller: `docs/assets/logo-512.png`.
Wordmarks: `docs/assets/wordmark-light.png` (for dark backgrounds), `docs/assets/wordmark-dark.png`.
Cover / banner (if asked): `docs/assets/demo-thumbnail.jpg` (1280×720).

## Vision (short — one line)
```
Every view should pay, fairly. Brands fund a fixed USDC pool on Arc; it's split pro-rata by verified YouTube views and paid to every creator instantly, anywhere in the world.
```

## Category / tags
Category: **Payments** (alt: Consumer / Creator economy)
Tags: `Arc` `USDC` `EURC` `Payments` `Creator Economy` `Circle` `Stablecoins`

## Links
| Field | Value |
|---|---|
| Website / live app | https://clippool.fun |
| GitHub | https://github.com/lazydevpro/clippool |
| Demo video | https://youtu.be/6AJOfA3wmtU |
| Mainnet contract v2 (verified) | https://explorer.arc.io/address/0xAe32115c22ccdc7eb1654053023aCaD84050b89a |
| Live mainnet campaign | https://clippool.fun/c/1 |
| Testnet contract v2 (verified) | https://explorer.testnet.arc.io/address/0x0B7B9318CC762055414eEBf90d02D21936F08868 |
| Builder profile | ⟨https://github.com/lazydevpro / X / Farcaster⟩ |

## Short description (if the form has a "what it does / what it uses Arc for" box)
```
ClipPool is a pro-rata creator campaign platform on Arc. A brand locks a fixed USDC (or EURC) pool in one transaction; creators submit YouTube Shorts — proving channel ownership with read-only Connect YouTube — and when the campaign ends the pool is split by views, likes or comments — the brand's choice — (with a per-creator cap; brands can optionally approve each Short) and pushed to every creator's wallet in a single transaction. It uses Arc for USDC-as-gas with ~$0.001 fees (paying many creators a few cents each is economical), sub-second deterministic finality (payouts are final instantly), native USDC/EURC with EIP-2612 permit (one-transaction funding), and Circle user-controlled wallets (Google sign-in wallets on Arc).
```

---

## BUIDL description (long — Markdown)

```markdown
# ClipPool — get paid for every view, fairly

**Live:** https://clippool.fun · **Demo (2:30):** https://youtu.be/6AJOfA3wmtU · **Code:** https://github.com/lazydevpro/clippool
**Arc mainnet contract (verified):** `0xAe32115c22ccdc7eb1654053023aCaD84050b89a`

## The problem
Brands already pay creators per view — "clipping" platforms pay millions to creators who post Shorts for a campaign.
But the model is broken in three ways:
1. **First-come budget drain.** Fixed-CPM budgets run out; late creators with great posts earn nothing and can't see how much budget is left.
2. **Opaque, slow payouts.** The platform decides what counts and pays through card rails that don't reach every country where creators work.
3. **Rejection incentive.** When rejecting a submission saves the brand money, creators carry the risk.

## The solution: a pro-rata pool escrowed on Arc
- A brand locks a **fixed USDC or EURC pool** in the ClipPool contract — one signature + one transaction (EIP-2612 permit). Campaign rules are pinned onchain by hash.
- Creators submit YouTube Shorts with **no gas and no signup fee**. **Connect YouTube** (read-only OAuth) proves channel ownership — no codes in descriptions (a per-campaign binding code is the fallback).
- Everyone sees a **live leaderboard** of estimated payouts.
- After the window, an oracle snapshots views and computes a deterministic **water-filling pro-rata split** with a per-creator cap, then posts the **Merkle root** of payouts onchain.
- After a dispute window (48h on mainnet; a guardian can cancel a bad root), a keeper pays **every creator in one `claimMany` transaction**. One bad recipient (e.g. a blocklisted address) can't block the batch.

**Why it's fair:** the whole budget is always paid out; the brand can't claw back a live pool; rejecting a creator saves the brand nothing — their share goes to the other creators. Leftover from the cap is refunded; if no split is posted within 14 days the brand reclaims everything.

## What it uses Arc for
| Arc feature | How ClipPool uses it |
|---|---|
| USDC as gas, stable ~$0.001 fees | Paying hundreds of creators a few cents each is economical; brands pay gas in the USDC they already hold. |
| Sub-second deterministic finality | Payouts are final the moment they land — creators see money, not "pending". |
| Native USDC & EURC (FiatToken v2, EIP-2612) | One-transaction permit funding; EUR-denominated campaigns. |
| Circle user-controlled wallets on ARC | Creators without crypto get a USDC wallet on Arc with Google sign-in (live on testnet; mainnet pending Circle live config). |
| Arc Foundry | Fork tests against real Arc state: USDC permit, the 6-dp ERC-20 vs 18-dp native dual balance, the blocklist precompile. |

## Proof it works (onchain)
- **Arc testnet, scripted lifecycle (campaign #1):** permit-funded create → oracle root → 3 creators paid in one `claimMany` (≈0.0048 USDC total gas) → refund.
- **Arc testnet, full stack (campaign #2):** a **real YouTube Short** → oracle job snapshotted its views and posted the root → keeper paid the creator's Circle wallet **2 USDC**.
- **Anyone can verify:** the open-source CLI recomputes the split from the published snapshot and checks it against the onchain root — **PASS**.
- **Arc mainnet:** ClipPool v2 deployed and verified (Sourcify exact match): `0xAe32115c22ccdc7eb1654053023aCaD84050b89a` — 48h dispute window, 1h minimum measurement delay, USDC + EURC enabled.
- **Arc mainnet v1 (retired), full lifecycle:** launch campaign #1 on `0xDb224b1b1dA608d51d5D6D5C492d083c80F2Dfb9` closed with no submissions → the oracle posted an empty root ([tx](https://explorer.arc.io/tx/0xd3774f3deb91b77639042556cd594f3d8f06b432dab272570edef9edf4422e94)) and the brand reclaimed the full 5 USDC ([tx](https://explorer.arc.io/tx/0x6c3119162d791a3f9606e3bf5d7a2cd8110325d384662d05eb3ba36bbb868029)).
- **Arc testnet v2:** scripted lifecycle PASSED on `0x0B7B9318CC762055414eEBf90d02D21936F08868` — create → root → 3 creators paid in one `claimMany` ([tx](https://explorer.testnet.arc.io/tx/0x9a3116e0e99d58026115e4baf6ce8bef028ec486b81940f136b98f61e03bc607)) → refund.
- **Live on mainnet now:** launch campaign **#1** on v2 — 5 USDC escrowed, scored by **likes** with brand approval, open for Shorts until Nov 9: https://clippool.fun/c/1 ([creation tx](https://explorer.arc.io/tx/0x02b5f67c308d4aac68b6d11ec8b303bb66088b65ef64b0eb3390cb99b6c1e7a1)).

## Technical credibility
- **Smart contract:** `ClipPool.sol` — 100% line/branch coverage; unit, fuzz, invariant, cross-language golden-fixture and Arc fork tests (76 + 3 fork tests). Deploy-time immutable dispute window.
- **Allocation engine:** TypeScript, bigint-only, 565 tests incl. 500 randomized invariant cases; the same 10 golden fixtures are verified in Solidity.
- **App:** Next.js + API on Vercel, Neon Postgres, oracle/keeper/sync jobs on a cron, 172 server/client tests. CI on every push.
- **Compliance by design:** no raw YouTube statistics onchain (YouTube API policy: ≤30-day storage) — only payout amounts and a snapshot hash. Read-only YouTube scope; Google tokens are never stored.

## Trust model (stated honestly)
Pool custody, payout limits and refunds are **trustless** (contract-enforced). Which submissions count and view counts come from an **oracle** in v1 — mitigated by a published snapshot, a deterministic open-source script and the dispute window. Bot-view resistance is heuristic in v1 (cap, minimum views, channel age ≥ 30 days).

## What's next
- Mainnet pilot campaigns with Arc ecosystem projects as the first brands.
- Engaged-view metrics (creator-authorized YouTube Analytics, zkTLS) for bot resistance.
- TikTok / Instagram Reels; per-video measurement windows; CPM-then-pro-rata hybrid campaigns.
- Circle live wallets on mainnet; Google OAuth verification for public Connect YouTube.

## Team
Solo builder — ⟨name/handle⟩ · ⟨builder profile link⟩
```

---

## Demo video outline (for reference)
1. Problem → 2. Brand creates a campaign (one permit tx) → 3. Creator: Google wallet + Connect YouTube + submit →
4. Live leaderboard → 5. Snapshot root + verify PASS → 6. One-transaction payout → 7. Why Arc.
