# Demo video — recording script (Arc testnet, production URL)

Record on **https://clippool.vercel.app** (currently Arc testnet). Landscape 1920×1080, browser at 110–125% zoom,
dark theme. Target **2:30–3:00** after cutting the waiting parts. Tools: QuickTime/OBS for screen, optional voiceover.

## Before recording (≈10 min)
- [ ] Brand wallet in MetaMask/Rabby on **Arc Testnet** (chain 5042002, RPC `https://rpc.testnet.arc.io`) with ≥ 10 testnet USDC.
- [ ] Creator browser profile (or incognito) for the creator side — Google account that owns your YouTube channel
      (channel ≥ 30 days old; account added as a Google OAuth test user).
- [ ] A **new** Short ready to upload (e.g. `media/short/out/clippool-short.mp4`) — it must be *published after* the
      campaign starts, so upload it right after step 2.
- [ ] Terminal open in the repo for the verify step.

## Campaign settings (testnet)
Title "Arc Launch Week — Shorts about Arc", pool **5 USDC**, window **30 min**, measurement delay **1 hour**
(gives YouTube time to register views), cap **50%**, min views **1**.
Snapshot ≈ start + 1h30 · payout ≈ snapshot + 10 min. Cut the waits in editing.

## Shot list
| # | Time | Screen | Say / show |
|---|---|---|---|
| 1 | 0:00–0:15 | Landing page | "Pay-per-view budgets run out first-come-first-served and payouts are opaque. ClipPool splits a fixed USDC pool by views — paid instantly on Arc." |
| 2 | 0:15–0:45 | `/campaigns/new` → fill form → connect wallet → **one signature + one tx** → campaign page | "A brand locks 5 USDC with a single permit transaction. Rules are pinned onchain by hash." Click the creation tx → explorer. |
| 3 | 0:45–1:20 | Creator profile: `/c/<id>/submit` → wallet (Continue with Google → Circle wallet) → **Connect YouTube** → pick the Short → Submit → "You're in!" | "No gas, no seed phrase. Connect YouTube proves channel ownership read-only — no codes in descriptions." |
| 4 | 1:20–1:40 | Campaign page leaderboard (live estimate) | "Everyone sees the live split. No budget race: the pool is always fully spent, capped per creator." |
| 5 | 1:40–2:05 | After snapshot: `/c/<id>/receipts` (root, dispute countdown) + terminal `pnpm --filter @clippool/allocation verify snapshot.json --rpc … --address …` → **PASS** | "The oracle posts a Merkle root. Anyone can recompute the split and check it against the chain." |
| 6 | 2:05–2:30 | After payout: receipts "paid" + explorer `claimMany` tx + `/me` balance | "One transaction pays every creator — final in under a second, fractions of a cent in gas." |
| 7 | 2:30–2:50 | README "Why Arc" table or end card from the Short | "USDC gas, sub-second finality, native USDC/EURC, Circle wallets. Next: mainnet pilot with Arc ecosystem brands." |

## Triggering the jobs on cue (instead of waiting for the schedule)
GitHub → **Actions → cron → Run workflow** → choose `snapshot` (after the snapshot time) or `keeper` (after the dispute
window). Or ask Claude to trigger them. Scheduled runs also happen automatically (GitHub may lag a few minutes).

## Fallbacks
- Views still 0 at the snapshot → split is empty and the pool is refunded; re-run with a longer delay, or show
  campaign #2 (real Short, 10 views, paid 2 USDC) as the payout segment.
- Google popup blocked → use "Paste a wallet address" and the binding-code path (show it briefly as the fallback).
