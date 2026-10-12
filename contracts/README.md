# ClipPool contracts

`src/ClipPool.sol` holds every ClipPool campaign. A brand locks a USDC/EURC pool. After the snapshot, the oracle
posts a Merkle root of payout amounts. A dispute window follows (48h on mainnet), during which the guardian can
cancel the root. The keeper then pushes the claims with `claimMany`. The ABI is specified in
[`docs/plans/interfaces.md` §5](../docs/plans/interfaces.md), and the exported ABI lives in `abi/ClipPool.json`.

Timeline of a campaign (all bounds are inclusive at the start and exclusive at the end):

```
startTime ── endTime ──(measurementDelay ≥ MIN_MEASUREMENT_DELAY)── snapshotTime ──(≤ 14d: postRoot)──┐
                                                                                                      │ else refundNoRoot
rootPostedAt ──[DISPUTE_WINDOW: cancelRoot]── disputeEndsAt ──[90d: claim / claimMany]── claimDeadline
                                               └ refundRemainder (pool − totalAllocated)  └ sweepUnclaimed (totalAllocated − claimed)
```

`DISPUTE_WINDOW()` and `MIN_MEASUREMENT_DELAY()` are deploy-time immutables (constructor args, no setters), so
testnet deployments can run a full lifecycle in minutes. `ROOT_DEADLINE` (14d) and `CLAIM_PERIOD` (90d) are
constants everywhere.

| Chain | `DISPUTE_WINDOW` | `MIN_MEASUREMENT_DELAY` | Env override |
|---|---|---|---|
| 5042 (mainnet) | 48 hours | 1 hours | refused (`MainnetWindowOverride`) |
| 5042002 (testnet) | 10 minutes | 5 minutes | `DISPUTE_WINDOW_SECONDS` / `MIN_MEASUREMENT_DELAY_SECONDS` |
| 31337 (anvil) | 10 minutes | 1 minutes | same |

The constructor accepts a dispute window in `[5 minutes, 30 days]` (`InvalidDisputeWindow`) and a minimum
measurement delay in `[1 minutes, 30 days]` (`InvalidMinMeasurementDelay`). Offchain code must read both values
from the deployed contract rather than assume 48h / 1h.

## Build / test

```sh
forge build
forge test -vv                                                      # unit + fuzz + invariant + fixtures
forge coverage --report summary --no-match-coverage '(test|script)/'
forge inspect ClipPool abi --json > abi/ClipPool.json               # re-export the ABI after changes
```

- Unit tests deploy with the mainnet windows (48h / 1h) so boundary tests keep their meaning;
  `test_shortWindow_lifecycleBoundaries` covers a 10-minute deployment and `test/Deploy.t.sol` the per-chain
  window selection. The fork test deploys with the script's per-chain defaults (testnet: 10 min / 5 min).
- The golden allocation vectors in `test/fixtures/allocation-*.json` are owned by `packages/allocation`.
  `test/ClipPool.fixtures.t.sol` posts each vector's root and claims every proof. It then checks that
  `refundRemainder` returns `leftover`. When no fixtures exist, the test logs a skip.
- The mocks are `MockERC20Permit` (6 decimals, EIP-2612) and `BlocklistToken`, which reverts or returns false
  on transfers to a blocked address, the way USDC behaves for blocklisted accounts.

## Deploy

Environment variables come from the repo-root `.env`. Never commit them.

- `DEPLOYER_PRIVATE_KEY`: the broadcaster, who also becomes the owner.
- `ORACLE_PRIVATE_KEY`: only its address is used.
- `GUARDIAN_ADDRESS`
- `ARC_TESTNET_RPC_URL` / `ARC_MAINNET_RPC_URL`
- Optional, non-mainnet only: `DISPUTE_WINDOW_SECONDS`, `MIN_MEASUREMENT_DELAY_SECONDS` (see the table above).

The script allowlists USDC (`0x3600…0000`) and the chain's EURC. It supports chain 5042 (mainnet) and chain
5042002 (testnet), and on a broadcast it writes `deployments/<chainid>.json`
(`{address, deployBlock, oracle, guardian, disputeWindow, minMeasurementDelay}`, windows in seconds).

```sh
set -a; source ../.env; set +a

# simulate only (no transactions)
forge script script/Deploy.s.sol --rpc-url "$ARC_TESTNET_RPC_URL"

# testnet broadcast + Blockscout verification
forge script script/Deploy.s.sol --rpc-url "$ARC_TESTNET_RPC_URL" --broadcast \
  --with-gas-price 25gwei --priority-gas-price 1gwei \
  --verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
```

The user runs mainnet deploys, not agents. Mainnet uses `--rpc-url "$ARC_MAINNET_RPC_URL"` and
`--verifier-url https://explorer.arc.io/api/`.

To verify a contract that is already deployed:

```sh
forge verify-contract <address> src/ClipPool.sol:ClipPool \
  --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address,address,uint64,uint64)" \
      <owner> <oracle> <guardian> <disputeWindowSeconds> <minMeasurementDelaySeconds>)
```

## Arc notes

- Arc uses USDC for gas. Every transaction needs `maxFeePerGas ≥ 20 gwei`, and transactions below that are
  silently dropped. With forge, pass `--with-gas-price` (the max fee, e.g. `25gwei`) and
  `--priority-gas-price`. With cast, use `--gas-price` / `--priority-gas-price`.
- The USDC/EURC ERC-20s have **6 decimals**. Native-balance accounting is 18 decimals, so never mix the two.
- Transfers to `address(0)` or to blocklisted addresses revert. `claim` rejects `address(0)`. `claimMany`
  isolates per-item failures with `ClaimFailed`, and the failed item stays claimable. Blocklisted transfers
  still burn gas, so the keeper should `eth_call`-simulate first.
- The contract is compiled with `evm_version = "prague"`. Arc targets Osaka, and prague avoids opcodes that Arc
  may not support. Plain `forge` is used; use `arc-forge` for Arc fork tests once it is installed.
- `eth_getLogs` is limited to 10,000 blocks per call. Indexers should start from `deployBlock`.
