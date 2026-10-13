#!/usr/bin/env bash
# Deploy + verify ClipPool on Arc MAINNET (chain 5042). YOU run this — it spends real USDC (~0.13 gas).
# Reads keys from the git-ignored .env.mainnet. Asks for confirmation before broadcasting.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
export PATH="$HOME/.local/bin:$PATH"
set -a; eval "$(grep -E '^(ARC_MAINNET_RPC_URL|DEPLOYER_PRIVATE_KEY|ORACLE_PRIVATE_KEY|GUARDIAN_ADDRESS)=' ../.env.mainnet | sed 's/[[:space:]]*#.*$//')"; set +a
R="$ARC_MAINNET_RPC_URL"
[ "$(arc-cast chain-id --rpc-url "$R")" = "5042" ] || { echo "RPC is not Arc mainnet"; exit 1; }
[[ "${GUARDIAN_ADDRESS:-}" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Set GUARDIAN_ADDRESS (your wallet) in .env.mainnet first"; exit 1; }
DEP=$(arc-cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
ORA=$(arc-cast wallet address --private-key "$ORACLE_PRIVATE_KEY")
BAL=$(arc-cast balance "$DEP" --rpc-url "$R" --ether)
echo "Network   Arc mainnet (5042)"
echo "Deployer  $DEP  balance $BAL USDC (needs ≥ 0.2)"
echo "Oracle    $ORA"
echo "Guardian  $GUARDIAN_ADDRESS"
echo "Windows   dispute 48h · min measurement 1h · tokens USDC + EURC"
read -r -p "Type DEPLOY to broadcast to mainnet: " ok; [ "$ok" = "DEPLOY" ] || { echo "aborted"; exit 1; }
arc-forge script script/Deploy.s.sol:Deploy --rpc-url "$R" --broadcast \
  --with-gas-price 45gwei --priority-gas-price 1gwei
# explorer.arc.io's API is behind a Cloudflare challenge → verify via Sourcify (Blockscout shows it as verified)
ADDR=$(python3 -c "import json;print(json.load(open('deployments/5042.json'))['address'])")
arc-forge verify-contract "$ADDR" src/ClipPool.sol:ClipPool --chain 5042 --verifier sourcify --rpc-url "$R" --guess-constructor-args --watch
echo; cat deployments/5042.json; echo
echo "✓ Deployed. Tell Claude 'deployed' — it will verify the contract state and prepare the Vercel switch."
