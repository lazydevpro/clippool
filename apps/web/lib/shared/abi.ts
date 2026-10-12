import { parseAbi } from "viem";

// Mirrors docs/plans/interfaces.md §5. Regenerate from contracts/out once the contract lands.
export const clipPoolAbi = parseAbi([
  "struct CampaignParams { address token; uint128 pool; uint64 startTime; uint64 endTime; uint64 measurementDelay; uint16 maxShareBps; uint32 minViews; bytes32 rulesHash; }",
  "struct Claim { address account; uint256 amount; bytes32[] proof; }",
  "struct Campaign { address brand; address token; uint128 pool; uint128 totalAllocated; uint128 claimed; uint64 startTime; uint64 endTime; uint64 snapshotTime; uint64 rootPostedAt; uint16 maxShareBps; uint32 minViews; bytes32 rulesHash; bytes32 root; bytes32 snapshotHash; bool remainderRefunded; bool unclaimedSwept; }",

  "function createCampaign(CampaignParams p) returns (uint256 id)",
  "function createCampaignWithPermit(CampaignParams p, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256 id)",
  "function postRoot(uint256 id, bytes32 root, uint128 totalAllocated, bytes32 snapshotHash)",
  "function cancelRoot(uint256 id)",
  "function claim(uint256 id, address account, uint256 amount, bytes32[] proof)",
  "function claimMany(uint256 id, Claim[] claims) returns (uint256 succeeded)",
  "function refundRemainder(uint256 id)",
  "function sweepUnclaimed(uint256 id)",
  "function refundNoRoot(uint256 id)",
  "function getCampaign(uint256 id) view returns (Campaign)",
  "function isClaimed(uint256 id, address account) view returns (bool)",
  "function nextCampaignId() view returns (uint256)",
  "function bindingCode(uint256 id, address wallet) pure returns (bytes4)",
  "function oracle() view returns (address)",
  "function guardian() view returns (address)",
  // Deploy-time immutables (mainnet 48h / 1h, testnet 10 min / 5 min) — read them, never hardcode.
  "function DISPUTE_WINDOW() view returns (uint256)",
  "function MIN_MEASUREMENT_DELAY() view returns (uint256)",

  "event CampaignCreated(uint256 indexed id, address indexed brand, address indexed token, uint128 pool, uint64 startTime, uint64 endTime, uint64 snapshotTime, uint16 maxShareBps, uint32 minViews, bytes32 rulesHash)",
  "event RootPosted(uint256 indexed id, bytes32 root, uint128 totalAllocated, bytes32 snapshotHash, uint64 disputeEndsAt)",
  "event RootCancelled(uint256 indexed id, bytes32 root)",
  "event Claimed(uint256 indexed id, address indexed account, uint256 amount)",
  "event ClaimFailed(uint256 indexed id, address indexed account, uint256 amount, bytes reason)",
  "event RemainderRefunded(uint256 indexed id, address indexed brand, uint256 amount)",
  "event UnclaimedSwept(uint256 indexed id, address indexed brand, uint256 amount)",
  "event NoRootRefunded(uint256 indexed id, address indexed brand, uint256 amount)",
]);

// Minimal ERC-20 + EIP-2612 surface used for brand funding (USDC/EURC FiatToken v2 on Arc).
export const erc20PermitAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function nonces(address owner) view returns (uint256)",
]);
