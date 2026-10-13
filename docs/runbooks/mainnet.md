# Mainnet runbook — ClipPool on Arc (chain 5042)

You run every step that spends real USDC. Commands are copy-paste from the repo root unless noted.
Current production (https://clippool.fun) points at **testnet**; this runbook moves it to mainnet.

Timeline for the pilot: deploy (~10 min) → campaign window (e.g. 24h) → 1h measurement → **48h dispute window** →
payout. The grant needs a *live mainnet deployment + link*; the first payout lands ~3 days after the campaign starts.

---

## 0. Prerequisites
- Arc Foundry installed (`arc-forge --version`, `arc-cast --version`) — already on this machine in `~/.local/bin`.
- USDC on Arc mainnet in **your own wallet** (bridge via CCTP / Arc Portal / an exchange that supports Arc).
  Budget: ~3 USDC for operator gas + the pilot pool (e.g. 10 USDC).
- Your **guardian** = your own wallet address (can cancel a bad root during the dispute window).

## 1. Create fresh mainnet operator keys (never reuse the testnet ones)
```bash
arc-cast wallet new --number 3
```
Save the three private keys in your password manager as DEPLOYER / ORACLE / KEEPER, then create a git-ignored
`.env.mainnet` (matched by `.env.*` in `.gitignore`) containing **only** these lines:
```bash
ARC_MAINNET_RPC_URL=https://rpc.mainnet.arc.io
DEPLOYER_PRIVATE_KEY=0x…
ORACLE_PRIVATE_KEY=0x…
KEEPER_PRIVATE_KEY=0x…
GUARDIAN_ADDRESS=0x…your wallet…
```

## 2. Fund the operators (from your wallet)
Send native USDC on Arc mainnet: **deployer 1 USDC, oracle 1 USDC, keeper 1 USDC**
(oracle ≈ $0.01 per campaign, keeper ≈ $0.002 per creator paid).

## 3. Deploy + verify ClipPool
```bash
cd contracts
set -a; source ../.env.mainnet; set +a
arc-forge script script/Deploy.s.sol:Deploy --rpc-url "$ARC_MAINNET_RPC_URL" --broadcast \
  --with-gas-price 25gwei --priority-gas-price 1gwei \
  --verify --verifier blockscout --verifier-url https://explorer.arc.io/api/
cat deployments/5042.json        # address, deployBlock, disputeWindow 172800, minMeasurementDelay 3600
```
The script hard-codes 48h / 1h on chain 5042 and refuses overrides. Easiest path: `./scripts/fund-mainnet.sh` then `./scripts/deploy-mainnet.sh` (both confirm before sending). Verification uses
**Sourcify** (`--verifier sourcify`) because `explorer.arc.io/api` is behind a Cloudflare challenge; Blockscout then shows the contract as verified.

**Deployed 2026-10-13:** `0xDb224b1b1dA608d51d5D6D5C492d083c80F2Dfb9` (block 25,732,389), Sourcify exact match.

**Check it:**
```bash
A=$(python3 -c "import json;print(json.load(open('deployments/5042.json'))['address'])"); R=https://rpc.mainnet.arc.io
arc-cast call $A "DISPUTE_WINDOW()(uint256)" --rpc-url $R            # 172800
arc-cast call $A "MIN_MEASUREMENT_DELAY()(uint256)" --rpc-url $R     # 3600
arc-cast call $A "tokenAllowed(address)(bool)" 0x3600000000000000000000000000000000000000 --rpc-url $R   # true (USDC)
arc-cast call $A "tokenAllowed(address)(bool)" 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1 --rpc-url $R   # true (EURC)
arc-cast call $A "oracle()(address)" --rpc-url $R && arc-cast call $A "guardian()(address)" --rpc-url $R
```
Commit `contracts/deployments/5042.json` (public data only).

## 4. Separate database branch for mainnet
```bash
npx neon@latest branch create --name mainnet
npx neon@latest connection-string mainnet --pooled      # → DATABASE_URL for Vercel
cd apps/web && DATABASE_URL_UNPOOLED="$(npx neon@latest connection-string mainnet)" npx drizzle-kit migrate
```

## 5. Circle + Google for production
- Circle Console → switch to the **live/mainnet** environment → create a `LIVE_API_KEY:…` key → Wallets → User
  Controlled → Configurator → Social Logins → Google → same Web Client ID → copy the **live App ID**.
- Google Cloud → OAuth client → Authorized JavaScript origins: `https://clippool.fun`; Authorized redirect URIs:
  `https://clippool.fun/auth/callback`. Keep test users added until Google verifies `youtube.readonly`.

## 6. Switch production to mainnet (Vercel)
Each command prompts for the value (paste it; nothing is echoed to history):
```bash
for k in NEXT_PUBLIC_CHAIN NEXT_PUBLIC_ARC_RPC_URL NEXT_PUBLIC_CLIPPOOL_ADDRESS NEXT_PUBLIC_CLIPPOOL_DEPLOY_BLOCK \
         NEXT_PUBLIC_CIRCLE_APP_ID ORACLE_PRIVATE_KEY KEEPER_PRIVATE_KEY CIRCLE_API_KEY DATABASE_URL; do
  npx vercel env add "$k" production --force
done
npx vercel deploy --prod
```
Values: `NEXT_PUBLIC_CHAIN=arc`, `NEXT_PUBLIC_ARC_RPC_URL=https://rpc.mainnet.arc.io`, address + deployBlock from
`deployments/5042.json`, live Circle App ID / API key, mainnet oracle/keeper keys, mainnet Neon pooled URL.
Mark the keys and API key as sensitive when prompted.

**Check it:** https://clippool.fun shows "Arc" (not "Arc Testnet"); `/campaigns/new` shows 1h / 24h / 7d delays
and "dispute window 48 hours"; GitHub → Actions → cron → *Run workflow* → `sync` returns HTTP 200.

## 7. Pilot campaign
1. Open https://clippool.fun/campaigns/new with your wallet on **Arc mainnet** (MetaMask/Rabby).
2. Example: 10 USDC pool, 24h window, 1h measurement delay, 20% cap, min views 100, clear rules.
3. Sign the permit + create (one transaction). Share `https://clippool.fun/c/<id>` with creators.
4. Everything after is automatic (GitHub Actions cron → oracle snapshot → 48h dispute → keeper payout).
   Watch `/c/<id>/receipts`; verify the split with the CLI command shown there.

## 8. Safety & recovery
| Situation | Action |
|---|---|
| Bad root posted (wrong data) | Guardian (your wallet) calls `cancelRoot(id)` within 48h; fix data in DB; oracle reposts. |
| Oracle down / no root within 14 days | Brand calls `refundNoRoot(id)` → full refund. |
| Recipient blocklisted | Keeper skips it (logged); after 90 days the brand can `sweepUnclaimed(id)`. |
| Operator key leaked | Deploy a new ClipPool or `setOracle` / keeper rotation (owner = deployer key); move funds out of the leaked wallet. |
| Low operator balance | Top up oracle/keeper; cron jobs log failures in GitHub Actions. |

## 9. Then submit
Fill `docs/submission/dorahacks.md` (mainnet address, live URL, repo `https://github.com/lazydevpro/clippool`, demo
video, builder profile) and submit at https://dorahacks.io/hackathon/arc-microgrants/detail.
