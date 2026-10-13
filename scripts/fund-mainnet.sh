#!/usr/bin/env bash
# Spread gas USDC from the DEPLOYER wallet to the ORACLE and KEEPER on Arc MAINNET.
# YOU run this — it sends real USDC. Shows balances + plan, asks you to type FUND before sending.
# (bash 3.2 compatible — macOS default shell)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
set -a; eval "$(grep -E '^(ARC_MAINNET_RPC_URL|DEPLOYER_PRIVATE_KEY|ORACLE_PRIVATE_KEY|KEEPER_PRIVATE_KEY)=' .env.mainnet | sed 's/[[:space:]]*#.*$//')"; set +a
R="$ARC_MAINNET_RPC_URL"
[ "$(arc-cast chain-id --rpc-url "$R")" = "5042" ] || { echo "RPC is not Arc mainnet"; exit 1; }

DEP=$(arc-cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
ORA=$(arc-cast wallet address --private-key "$ORACLE_PRIVATE_KEY")
KEE=$(arc-cast wallet address --private-key "$KEEPER_PRIVATE_KEY")
TARGET=0.5    # native USDC per operator
RESERVE=0.3   # kept on the deployer for the deploy (~0.13) + headroom

bal() { arc-cast balance "$1" --rpc-url "$R" --ether; }
gt0() { python3 -c "import sys; sys.exit(0 if float('$1') > 0 else 1)"; }

printf "%-8s %s  %s USDC\n" deployer "$DEP" "$(bal "$DEP")"
PLAN=""; TOTAL=0
for pair in "oracle:$ORA" "keeper:$KEE"; do
  role=${pair%%:*}; addr=${pair#*:}
  have=$(bal "$addr")
  need=$(python3 -c "print(max(0, round($TARGET - $have, 6)))")
  printf "%-8s %s  %s USDC → top up %s\n" "$role" "$addr" "$have" "$need"
  if gt0 "$need"; then PLAN="$PLAN $role:$addr:$need"; TOTAL=$(python3 -c "print(round($TOTAL + $need, 6))"); fi
done
[ -n "$PLAN" ] || { echo "✓ Oracle and keeper already funded. Next: ./scripts/deploy-mainnet.sh"; exit 0; }

NEEDED=$(python3 -c "print(round($TOTAL + $RESERVE, 6))")
if ! python3 -c "import sys; sys.exit(0 if float('$(bal "$DEP")') >= $NEEDED else 1)"; then
  echo "Deployer needs ≥ $NEEDED USDC ($TOTAL to send + $RESERVE reserve). Fund $DEP first."; exit 1
fi

echo; echo "Will send from the deployer on Arc MAINNET (total $TOTAL USDC):"
for item in $PLAN; do role=${item%%:*}; rest=${item#*:}; echo "  $role ${rest%%:*}  +${rest#*:} USDC"; done
read -r -p "Type FUND to send real USDC: " ok; [ "$ok" = "FUND" ] || { echo "aborted"; exit 1; }
for item in $PLAN; do
  role=${item%%:*}; rest=${item#*:}; addr=${rest%%:*}; amt=${rest#*:}
  tx=$(arc-cast send "$addr" --value "${amt}ether" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" \
       --gas-price 45gwei --priority-gas-price 1gwei --json | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])")
  echo "✓ $role +$amt USDC  https://explorer.arc.io/tx/$tx"
done
printf "\ndeployer left: %s USDC\nNext: ./scripts/deploy-mainnet.sh\n" "$(bal "$DEP")"
