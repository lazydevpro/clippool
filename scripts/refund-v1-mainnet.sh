#!/usr/bin/env bash
# Reclaim the unallocated pool of a finished campaign on the ClipPool v1 MAINNET contract back to the brand
# (the DEPLOYER wallet). Campaign #1 had no submissions, so its full 5 USDC returns.
# YOU run this — it sends a mainnet transaction. Shows the campaign and asks you to type REFUND first.
# Usage: ./scripts/refund-v1-mainnet.sh [campaignId=1]   (bash 3.2 compatible)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
set -a; eval "$(grep -E '^(ARC_MAINNET_RPC_URL|DEPLOYER_PRIVATE_KEY)=' .env.mainnet | sed 's/[[:space:]]*#.*$//')"; set +a
R="$ARC_MAINNET_RPC_URL"; ID="${1:-1}"
V1=$(python3 -c "import json;print(json.load(open('contracts/deployments/5042-v1.json'))['address'])")
USDC=0x3600000000000000000000000000000000000000
[ "$(arc-cast chain-id --rpc-url "$R")" = "5042" ] || { echo "RPC is not Arc mainnet"; exit 1; }

DEP=$(arc-cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
C=$(arc-cast call "$V1" "getCampaign(uint256)((address,address,uint128,uint128,uint128,uint64,uint64,uint64,uint64,uint16,uint32,bytes32,bytes32,bytes32,bool,bool))" "$ID" --rpc-url "$R")
echo "ClipPool v1  $V1"
echo "Campaign #$ID $C"
echo "Brand wallet $DEP  USDC before: $(arc-cast call $USDC 'balanceOf(address)(uint256)' "$DEP" --rpc-url "$R")"
read -r -p "Type REFUND to send refundRemainder($ID) on Arc mainnet: " ok; [ "$ok" = "REFUND" ] || { echo "aborted"; exit 1; }
arc-cast send "$V1" "refundRemainder(uint256)" "$ID" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" \
  --gas-price 45gwei --priority-gas-price 1gwei --json | python3 -c "import sys,json; t=json.load(sys.stdin); print(('✓' if t['status'] in ('0x1',1,'1') else '✗'), 'https://explorer.arc.io/tx/'+t['transactionHash'])"
echo "Brand wallet USDC after: $(arc-cast call $USDC 'balanceOf(address)(uint256)' "$DEP" --rpc-url "$R")"
