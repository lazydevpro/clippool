# ClipPool — Spec (v1)

> Working name. Pro-rata creator campaigns on Arc: brands fund a USDC pool, everyone who posts
> qualifying content earns a share proportional to proven traction, paid instantly on Arc.

Status: **Draft for review** · Date: 2026-10-12 · Target: Arc Microgrants (DoraHacks) — live on Arc mainnet.

## 1. Problem

Brands already pay creators per view ("clipping"): Whop Content Rewards has paid out ~$2.6M to ~8.5k
earners (~$887k in Feb 2026 alone); MrBeast's Vyro pays $3 per 1k views. Today's model has three flaws:

1. **First-come budget drain** — fixed CPM campaigns stop paying when the budget runs out; late
   creators with strong posts earn nothing, and creators can't tell how much budget is left.
2. **Opaque, trusted payouts** — the brand/platform decides what counts and pays via Stripe; creators
   can't verify the split, and Stripe payouts don't reach every country where clippers work.
3. **Brand-side incentive to reject** — when rejecting a submission saves the brand money, creators
   carry the risk of arbitrary rejection.

## 2. Solution

A **pro-rata pool** escrowed onchain on Arc:

- A brand locks a fixed USDC (or EURC) pool in a contract for a campaign window.
- Any creator posts a qualifying YouTube Short and submits it — **no gas, no signup fee**, just a wallet address.
- After the measurement window, the pool is split **proportionally to views**, with a per-creator cap.
- Payouts are pushed to every creator's wallet in batches; anyone can verify the split.

Key properties:
- **Budget is always fully and fairly spent** (minus cap/rounding leftovers refunded to the brand).
- **The brand can't claw back the pool** once the campaign is live, and gains nothing by rejecting
  submissions — rejected share is redistributed to other creators, not refunded.
- **Global, instant payouts** in USDC on Arc (sub-second finality, ~$0.001/transfer).

## 3. Users

| User | Goal |
|---|---|
| **Brand / project** (first: Arc ecosystem projects) | Buy reach with a fixed, predictable budget; pay only for real traction. |
| **Creator / clipper** (global, many in IN/PH/LATAM) | Earn from posts with transparent rules and guaranteed, instant payout. |
| **Verifier (anyone)** | Recompute the split from published data and confirm the onchain payout matches. |

## 4. Scope

### In scope (v1)
- Platform: **YouTube Shorts only** (official YouTube Data API; X is excluded — X banned
  pay-to-post apps in Jan 2026).
- Metric: **views** (`statistics.viewCount`) at a single snapshot time.
- Tokens: **USDC and EURC** on Arc mainnet (both ERC-20, 6 decimals).
- One campaign contract (`ClipPool`) holding many campaigns.
- Web app: create/fund campaign, campaign page + live estimated leaderboard, creator submission,
  payout receipts.
- Oracle/keeper backend: validate submissions, snapshot, compute allocation, post Merkle root, push payouts.

### Out of scope (v1 → later)
- TikTok / Instagram / X; likes, watch-time, or engaged-view metrics.
- zkTLS (Reclaim) trust-minimized metrics — **v2**.
- Platform fees, brand moderation tooling beyond simple reject, fiat onramp for brands.
- Per-video measurement windows (v1 uses one campaign-wide snapshot).

## 5. Functional requirements

### 5.1 Campaign creation (brand)
- Brand sets: token (USDC/EURC), pool amount, `startTime`, `endTime`, measurement delay
  (default 7 days after `endTime`), per-creator cap (`maxShareBps`, default 2000 = 20%),
  minimum views per video (`minViews`, default 1,000), rules text (hashed onchain, full text offchain).
- Funds in **one transaction** via EIP-2612 `permit` (USDC and EURC on Arc support it) — no separate approve.
- Pool is locked from creation; brand can't withdraw except as defined in §5.5.

### 5.2 Submission (creator)
> **Update 2026-10-12:** the main path is **Connect YouTube** — Google OAuth with the read-only
> `youtube.readonly` scope proves channel ownership once (`channels.list?mine=true`), linking the channel
> to the payout wallet; creators then pick eligible Shorts without editing descriptions. The binding
> code below remains as a fallback (no OAuth / before Google app verification).

- Creator enters their payout wallet; the app shows a **binding code** =
  first 8 hex chars of `keccak256(campaignId ‖ wallet)`, e.g. `cp-7f3k9a2b`.
- Creator puts the code in the Short's description, then submits the video URL.
- Backend validates via YouTube Data API (`videos.list`, 1 quota unit per ≤50 videos):
  - description contains the code for the claimed wallet (proves the submitter controls the video);
  - `publishedAt` within `[startTime, endTime]`;
  - `contentDetails.duration` ≤ 180 s (Shorts limit; no official "is Short" flag exists);
  - video is public; not already submitted.
- **One payout wallet per channel per campaign** (first valid submission locks it); a channel may submit several videos.
- Submissions are stored offchain (no creator gas). The submission list is published with the snapshot.

### 5.3 Snapshot & allocation (oracle)
At `endTime + measurementDelay`:
1. Re-fetch `viewCount` for every submission; drop deleted/private videos and videos below `minViews`.
2. Aggregate views per **payout wallet** → score `s_c` (creator = wallet; see `interfaces.md` §1–2).
3. **Water-filling cap** (deterministic, integer math, wallets sorted by lowercase address):
   ```
   remaining = pool; active = all channels; cap = pool * maxShareBps / 10000
   loop:
     S = Σ s_c over active
     tentative_c = floor(remaining * s_c / S)
     capped = { c in active : tentative_c >= cap }
     if capped is empty: alloc_c = tentative_c for all active; break
     for c in capped: alloc_c = cap; remaining -= cap; remove c from active
     if active is empty: break
   leftover = pool - Σ alloc_c        # cap overflow + rounding dust → refunded to brand
   ```
4. Build an OpenZeppelin `StandardMerkleTree` over `(campaignId, wallet, amount)` leaves.
5. Publish the snapshot file (submissions, views, allocation, script version) and post
   `root`, `totalAllocated`, and `snapshotHash` onchain.

### 5.4 Dispute window & payout
- After the root is posted, a **dispute window** opens (48h on mainnet; 10 min on testnet for fast end-to-end
  runs — a deploy-time immutable, see interfaces.md §5). During it, a guardian key can cancel
  the root (e.g. bad data); the oracle reposts a corrected root.
- After the window: anyone can call `claim(campaignId, wallet, amount, proof)`. Funds go to `wallet`.
- The keeper **pushes all claims automatically** in batches (`claimMany`), so creators do nothing.
- Each claim in a batch is isolated: a failing transfer (e.g. USDC-blocklisted address) is skipped
  and logged, not reverting the batch. The keeper also simulates each claim before sending.

### 5.5 Refunds (brand)
- After finalization, the brand withdraws `pool − totalAllocated` (cap overflow + dust).
- **Liveness guarantee:** if no root is finalized within `endTime + measurementDelay + 14 days`,
  the brand can withdraw the full remaining pool.
- If a campaign receives no valid submissions, the brand gets the full refund.

### 5.6 Transparency
- Campaign page shows the pool, rules, live **estimated** shares (current views, pro-rata), and
  after payout, every allocation with its claim transaction.
- A public script lets anyone recompute the Merkle root from the snapshot file.

## 6. Trust model (v1) — stated honestly

| Component | Trust |
|---|---|
| Pool custody, payout limits, refunds | **Trustless** — contract-enforced. |
| Which submissions are valid, view counts | **Oracle-trusted** (our signer), mitigated by a published snapshot, a deterministic script, and a dispute window (48h on mainnet). |
| View authenticity (bots) | **Heuristic** — caps, minimum views, channel checks; brand can flag. Fully solving this is v2 (engaged-view metrics via zkTLS). |

## 7. Compliance constraints

- **YouTube API Developer Policies III.E.4:** statistics fetched with an API key must not be stored
  or displayed for more than 30 days. ⇒ **No raw view counts onchain.** Onchain we store only the
  Merkle root of payout *amounts* plus a hash of the snapshot file. The snapshot file (with views)
  is kept for the dispute window and deleted or refreshed within 30 days. *(Open question §10.1.)*
- **X:** excluded (pay-to-post apps banned Jan 2026).
- **Disclosure:** campaign rules require creators to follow YouTube's paid-promotion disclosure.
- **Sanctions/blocklist:** USDC/EURC blocklisted addresses can't receive funds; their share stays
  claimable and is refunded to the brand after a timeout (see plan).

## 8. Arc-specific requirements

- USDC ERC-20 at `0x3600000000000000000000000000000000000000` (**6 decimals**); EURC at
  `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` (6 decimals). Never mix with native 18-decimal values.
- All transactions: `maxFeePerGas ≥ 20 gwei` (lower is silently dropped).
- Value transfers to `address(0)` revert; blocklisted transfers revert *and still consume gas* —
  the keeper must `eth_call`-simulate each claim before sending.
- `eth_getLogs` max 10,000 blocks per call — the indexer pages accordingly.
- Use **Arc Foundry** (`arc-forge`/`arc-cast`) to build and deploy; verify the contract on `explorer.arc.io`.

## 9. Acceptance criteria (definition of done for the microgrant submission)

1. `ClipPool` is deployed and verified on **Arc mainnet**; public repo with tests passing.
2. A brand can create and fund a campaign in one transaction (permit) from the web app.
3. A creator can submit a Short with no gas and no account beyond a wallet address.
4. The allocation script reproduces the onchain root from the published snapshot (test + CLI).
5. Payouts land in creators' wallets automatically after the dispute window; receipts link to Arc transactions.
6. Brand refund and liveness-refund paths work (tested on a mainnet fork and on testnet).
7. **One real pilot campaign** runs end-to-end on mainnet (small self-funded pool, ≥3 creators).
8. README explains what it does, what Arc is used for, and the trust model.

## 10. Open questions / decisions (defaults chosen; flag to revisit)

1. **YouTube data retention vs onchain transparency** — default: only payout amounts onchain, view
   data offchain ≤30 days. Long-term: creator-authorized data (OAuth or zkTLS) may allow more.
2. **Platform fee** — default **0%** in v1.
3. **Cap overflow** — default **refund to brand** (alternative: ignore the cap when there are too few creators).
4. **Single snapshot vs per-video windows** — default a single snapshot at `endTime + 7d`; late
   posts get fewer days to accumulate views (documented in rules).
5. **Hosting stack** — default **Next.js on Vercel + Postgres (Neon) + Vercel Cron**; alternative Cloudflare Workers + D1.
6. **Name** — "ClipPool" is a placeholder.
