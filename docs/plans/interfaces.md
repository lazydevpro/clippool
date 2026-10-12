# ClipPool — Shared interfaces (source of truth for all workstreams)

If you need to change anything here, say so in your final report — don't silently diverge.

## 1. Creator identity
- **Creator = payout wallet.** A YouTube channel locks to one wallet per campaign (first valid submission).
  Several channels may map to the same wallet; scores aggregate **per wallet**, and the cap applies **per wallet**.
- Binding code shown to the creator and required in the video description:
  `"cp-" + keccak256(abi.encodePacked(uint256 campaignId, address wallet)).slice(2, 10)` (lowercase hex, 8 chars).
  Wallet is checksummed input but hashed as a 20-byte address.

## 2. Allocation algorithm (deterministic, bigint, floor division)
```
inputs: pool (uint, token base units, 6 decimals), maxShareBps (uint16), minViews (uint),
        submissions[{videoId, channelId, wallet, views}]
1. drop submissions with views < minViews
2. score[wallet] = Σ views of remaining submissions for that wallet (wallet compared lowercase)
3. wallets sorted ascending by lowercase hex address
4. cap = pool * maxShareBps / 10000           (floor)
5. remaining = pool; active = all wallets with score > 0; alloc = {}
   loop:
     S = Σ score[w] for w in active
     if S == 0: break
     tentative[w] = remaining * score[w] / S    (floor)
     capped = [w in active where tentative[w] >= cap]
     if capped empty: alloc[w] = tentative[w] for all w in active; break
     for w in capped (in sorted order): alloc[w] = cap; remaining -= cap; remove w from active
     if active empty: break
6. drop wallets with alloc == 0
7. totalAllocated = Σ alloc; leftover = pool - totalAllocated
```
`maxShareBps = 10000` means "no cap".

## 3. Merkle tree
- OpenZeppelin `StandardMerkleTree.of(values, ["uint256", "address", "uint256"])`,
  values = `[campaignId, wallet, amount]` (wallet checksummed, numbers as decimal strings).
- Solidity leaf: `keccak256(bytes.concat(keccak256(abi.encode(campaignId, account, amount))))`.

## 4. Golden fixture format — `contracts/test/fixtures/allocation-*.json`
Produced by `packages/allocation` (owner), consumed by Solidity tests and TS tests.
All big numbers are **decimal strings**.
```json
{
  "name": "whale-capped",
  "description": "one wallet exceeds the 20% cap; excess redistributed",
  "campaign": { "id": "1", "pool": "1000000000", "maxShareBps": 2000, "minViews": "1000" },
  "submissions": [
    { "videoId": "abc123def45", "channelId": "UCxxxxxxxxxxxxxxxxxxxxxx", "wallet": "0x…", "views": "250000" }
  ],
  "expected": {
    "allocations": [ { "wallet": "0x…", "amount": "200000000" } ],
    "totalAllocated": "1000000000",
    "leftover": "0",
    "root": "0x…",
    "proofs": [ { "wallet": "0x…", "amount": "200000000", "proof": ["0x…"] } ]
  }
}
```
`allocations` and `proofs` are sorted ascending by lowercase wallet.

## 5. Contract ABI — `ClipPool.sol` (Solidity ^0.8.24)
```solidity
struct CampaignParams {
  address token; uint128 pool; uint64 startTime; uint64 endTime;
  uint64 measurementDelay; uint16 maxShareBps; uint32 minViews; bytes32 rulesHash;
}
struct Claim { address account; uint256 amount; bytes32[] proof; }

function createCampaign(CampaignParams calldata p) external returns (uint256 id);
function createCampaignWithPermit(CampaignParams calldata p, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256 id);
function postRoot(uint256 id, bytes32 root, uint128 totalAllocated, bytes32 snapshotHash) external; // onlyOracle
function cancelRoot(uint256 id) external;                                                           // onlyGuardian, inside dispute window
function claim(uint256 id, address account, uint256 amount, bytes32[] calldata proof) external;
function claimMany(uint256 id, Claim[] calldata claims) external returns (uint256 succeeded);
function refundRemainder(uint256 id) external;  // brand; after dispute window; pool - totalAllocated, once
function sweepUnclaimed(uint256 id) external;   // brand; after claim deadline; totalAllocated - claimed
function refundNoRoot(uint256 id) external;     // brand; no root by snapshotTime + ROOT_DEADLINE

function campaigns(uint256 id) external view returns (Campaign memory); // via getCampaign(id)
function getCampaign(uint256 id) external view returns (Campaign memory);
function isClaimed(uint256 id, address account) external view returns (bool);
function nextCampaignId() external view returns (uint256);              // ids start at 1
function bindingCode(uint256 id, address wallet) external pure returns (bytes4); // first 4 bytes of keccak(abi.encodePacked(id, wallet))

constructor(address owner_, address oracle_, address guardian_, uint64 disputeWindow_, uint64 minMeasurementDelay_);
// reverts InvalidDisputeWindow(uint256) unless 5 minutes ≤ disputeWindow_ ≤ 30 days,
//         InvalidMinMeasurementDelay(uint256) unless 1 minutes ≤ minMeasurementDelay_ ≤ 30 days

// admin (owner): setOracle(address), setGuardian(address), setTokenAllowed(address,bool)
// constants: ROOT_DEADLINE = 14 days, CLAIM_PERIOD = 90 days
// deploy-time immutables (no setters), same getter names as the former constants:
function DISPUTE_WINDOW() external view returns (uint256);        // seconds
function MIN_MEASUREMENT_DELAY() external view returns (uint256); // seconds

event CampaignCreated(uint256 indexed id, address indexed brand, address indexed token, uint128 pool, uint64 startTime, uint64 endTime, uint64 snapshotTime, uint16 maxShareBps, uint32 minViews, bytes32 rulesHash);
event RootPosted(uint256 indexed id, bytes32 root, uint128 totalAllocated, bytes32 snapshotHash, uint64 disputeEndsAt);
event RootCancelled(uint256 indexed id, bytes32 root);
event Claimed(uint256 indexed id, address indexed account, uint256 amount);
event ClaimFailed(uint256 indexed id, address indexed account, uint256 amount, bytes reason);
event RemainderRefunded(uint256 indexed id, address indexed brand, uint256 amount);
event UnclaimedSwept(uint256 indexed id, address indexed brand, uint256 amount);
event NoRootRefunded(uint256 indexed id, address indexed brand, uint256 amount);
```
`Campaign` struct fields (getCampaign): `brand, token, pool, totalAllocated, claimed, startTime, endTime,
snapshotTime, rootPostedAt, maxShareBps, minViews, rulesHash, root, snapshotHash, remainderRefunded, unclaimedSwept`.
`snapshotTime = endTime + measurementDelay`.

Per-network windows (set by `contracts/script/Deploy.s.sol`):

| Chain | `DISPUTE_WINDOW` | `MIN_MEASUREMENT_DELAY` |
|---|---|---|
| 5042 (mainnet) | 48 hours (env overrides refused) | 1 hours |
| 5042002 (testnet) | 10 minutes | 5 minutes |
| 31337 (anvil) | 10 minutes | 1 minutes |

Testnet/anvil accept `DISPUTE_WINDOW_SECONDS` / `MIN_MEASUREMENT_DELAY_SECONDS` overrides. Offchain code must read
both getters from the deployed contract (web: `ChainGateway.getWindows()`, `useContractWindows()`, and the
`disputeWindow` field of `CampaignSummary`); 48h / 1h is only a fallback when the contract can't be read.

## 6. Arc constants
| | Mainnet (5042) | Testnet (5042002) |
|---|---|---|
| USDC (ERC-20, 6 dp) | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |
| EURC (6 dp) | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Explorer | https://explorer.arc.io | https://explorer.testnet.arc.io |
- viem: `import { arc, arcTestnet } from "viem/chains"` (viem ≥ 2.57).
- Always `maxFeePerGas ≥ 20 gwei`. `eth_getLogs` ≤ 10,000 blocks per call.

## 7. Workstream file ownership
| Workstream | Owns |
|---|---|
| contracts | `contracts/**` except `contracts/test/fixtures/**` |
| allocation | `packages/allocation/**`, `contracts/test/fixtures/**` |
| web-frontend | `apps/web/app/**` except `app/api/**`; `apps/web/components/**` (shadcn ui already installed); `apps/web/lib/client/**`; `apps/web/hooks/**` |
| web-backend | `apps/web/app/api/**`, `apps/web/lib/server/**`, `apps/web/lib/db/**`, `apps/web/drizzle.config.ts`, `apps/web/lib/shared/**` (types + ABI shared with frontend) |
Dependencies are pre-installed; do not run `pnpm add` without listing why in your report.
