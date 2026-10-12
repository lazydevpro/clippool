// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ClipPool — pro-rata creator campaigns on Arc
/// @notice A brand locks a USDC/EURC pool for a campaign. After the measurement window an offchain oracle
///         posts a Merkle root of payout amounts (OZ StandardMerkleTree over `(campaignId, account, amount)`).
///         After the dispute window (deploy-time immutable: 48h on mainnet) anyone (normally the keeper) pushes claims to creators' wallets.
///         The brand can only withdraw what the rules allow: cap overflow / dust (`refundRemainder`),
///         unclaimed amounts after the claim period (`sweepUnclaimed`), or the whole pool if no root was
///         posted in time (`refundNoRoot`).
/// @dev Spec: docs/plans/interfaces.md §5. Tokens are allowlisted (USDC/EURC on Arc, 6 decimals, standard
///      ERC-20 semantics, no fee-on-transfer).
contract ClipPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────── Types ───────────────────────────────────────────

    struct CampaignParams {
        address token;
        uint128 pool;
        uint64 startTime;
        uint64 endTime;
        uint64 measurementDelay;
        uint16 maxShareBps;
        uint32 minViews;
        bytes32 rulesHash;
    }

    struct Claim {
        address account;
        uint256 amount;
        bytes32[] proof;
    }

    struct Campaign {
        address brand;
        address token;
        uint128 pool;
        uint128 totalAllocated;
        uint128 claimed;
        uint64 startTime;
        uint64 endTime;
        uint64 snapshotTime;
        uint64 rootPostedAt;
        uint16 maxShareBps;
        uint32 minViews;
        bytes32 rulesHash;
        bytes32 root;
        bytes32 snapshotHash;
        bool remainderRefunded;
        bool unclaimedSwept;
    }

    // ───────────────────────────────────── Constants / immutables ────────────────────────────────

    /// @notice Time after `snapshotTime` within which the oracle must post a root (else `refundNoRoot`).
    uint256 public constant ROOT_DEADLINE = 14 days;
    /// @notice Time after the dispute window during which claims are open (then `sweepUnclaimed`).
    uint256 public constant CLAIM_PERIOD = 90 days;

    /// @dev Constructor bounds for the deploy-time windows.
    uint256 private constant DISPUTE_WINDOW_MIN = 5 minutes;
    uint256 private constant DISPUTE_WINDOW_MAX = 30 days;
    uint256 private constant MIN_MEASUREMENT_DELAY_MIN = 1 minutes;
    uint256 private constant MIN_MEASUREMENT_DELAY_MAX = 30 days;

    /// @dev Set once at deploy (mainnet: 48 hours); read via `DISPUTE_WINDOW()`.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 private immutable _disputeWindow;
    /// @dev Set once at deploy (mainnet: 1 hours); read via `MIN_MEASUREMENT_DELAY()`.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 private immutable _minMeasurementDelay;

    // ────────────────────────────────────────── Storage ──────────────────────────────────────────

    /// @notice Address allowed to post Merkle roots.
    address public oracle;
    /// @notice Address allowed to cancel a root during its dispute window.
    address public guardian;
    /// @notice Id the next created campaign will get (ids start at 1).
    uint256 public nextCampaignId = 1;
    /// @notice Tokens accepted as campaign pools.
    mapping(address token => bool allowed) public tokenAllowed;

    mapping(uint256 id => Campaign) private _campaigns;
    mapping(uint256 id => mapping(address account => bool)) private _claimed;

    // ────────────────────────────────────────── Events ───────────────────────────────────────────

    event CampaignCreated(
        uint256 indexed id,
        address indexed brand,
        address indexed token,
        uint128 pool,
        uint64 startTime,
        uint64 endTime,
        uint64 snapshotTime,
        uint16 maxShareBps,
        uint32 minViews,
        bytes32 rulesHash
    );
    event RootPosted(
        uint256 indexed id, bytes32 root, uint128 totalAllocated, bytes32 snapshotHash, uint64 disputeEndsAt
    );
    event RootCancelled(uint256 indexed id, bytes32 root);
    event Claimed(uint256 indexed id, address indexed account, uint256 amount);
    event ClaimFailed(uint256 indexed id, address indexed account, uint256 amount, bytes reason);
    event RemainderRefunded(uint256 indexed id, address indexed brand, uint256 amount);
    event UnclaimedSwept(uint256 indexed id, address indexed brand, uint256 amount);
    event NoRootRefunded(uint256 indexed id, address indexed brand, uint256 amount);

    // Admin events (additive to interfaces.md §5).
    event OracleSet(address indexed oracle);
    event GuardianSet(address indexed guardian);
    event TokenAllowedSet(address indexed token, bool allowed);

    // ────────────────────────────────────────── Errors ───────────────────────────────────────────

    error ZeroAddress();
    error InvalidDisputeWindow(uint256 disputeWindow);
    error InvalidMinMeasurementDelay(uint256 minMeasurementDelay);
    error TokenNotAllowed(address token);
    error InvalidPool();
    error InvalidTimes();
    error InvalidMeasurementDelay();
    error InvalidMaxShare();
    error PermitFailed();
    error CampaignNotFound(uint256 id);
    error NotOracle();
    error NotGuardian();
    error NotBrand();
    error InvalidRoot();
    error SnapshotNotReached();
    error RootAlreadyPosted();
    error RootDeadlinePassed();
    error RootDeadlineNotPassed();
    error AllocationExceedsPool();
    error CampaignRefunded();
    error NoRoot();
    error DisputeWindowActive();
    error DisputeWindowEnded();
    error ClaimPeriodEnded();
    error ClaimPeriodActive();
    error AlreadyClaimed();
    error ExceedsAllocation();
    error InvalidProof();
    error AlreadyRefunded();
    error AlreadySwept();
    error TransferFailed();

    // ───────────────────────────────────────── Modifiers ─────────────────────────────────────────

    modifier onlyOracle() {
        _checkOracle();
        _;
    }

    modifier onlyGuardian() {
        _checkGuardian();
        _;
    }

    // ──────────────────────────────────────── Constructor ────────────────────────────────────────

    /// @param owner_ Admin (token allowlist, roles). Ownership transfers are two-step.
    /// @param oracle_ Root poster.
    /// @param guardian_ Root canceller.
    /// @param disputeWindow_ Dispute window in seconds, in [5 minutes, 30 days] (mainnet: 48 hours).
    /// @param minMeasurementDelay_ Minimum `measurementDelay` in seconds, in [1 minutes, 30 days] (mainnet: 1 hours).
    constructor(address owner_, address oracle_, address guardian_, uint64 disputeWindow_, uint64 minMeasurementDelay_)
        Ownable(owner_)
    {
        if (oracle_ == address(0) || guardian_ == address(0)) revert ZeroAddress();
        if (disputeWindow_ < DISPUTE_WINDOW_MIN || disputeWindow_ > DISPUTE_WINDOW_MAX) {
            revert InvalidDisputeWindow(disputeWindow_);
        }
        if (minMeasurementDelay_ < MIN_MEASUREMENT_DELAY_MIN || minMeasurementDelay_ > MIN_MEASUREMENT_DELAY_MAX) {
            revert InvalidMinMeasurementDelay(minMeasurementDelay_);
        }
        _disputeWindow = disputeWindow_;
        _minMeasurementDelay = minMeasurementDelay_;
        oracle = oracle_;
        guardian = guardian_;
        emit OracleSet(oracle_);
        emit GuardianSet(guardian_);
    }

    // ─────────────────────────────────────────── Admin ───────────────────────────────────────────

    /// @notice Set the oracle (root poster).
    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    /// @notice Set the guardian (root canceller).
    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Allow or disallow a token for new campaigns. Existing campaigns are unaffected.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenAllowedSet(token, allowed);
    }

    // ────────────────────────────────────────── Brand ────────────────────────────────────────────

    /// @notice Create and fund a campaign. Requires a prior `approve(this, p.pool)`.
    /// @return id The new campaign id.
    function createCampaign(CampaignParams calldata p) external nonReentrant returns (uint256 id) {
        _validate(p);
        id = _create(p);
    }

    /// @notice Create and fund a campaign in one transaction using an EIP-2612 permit for `p.pool`.
    /// @dev If the permit call reverts (e.g. it was front-run and the nonce already used) but the allowance
    ///      is already sufficient, creation proceeds.
    /// @return id The new campaign id.
    function createCampaignWithPermit(CampaignParams calldata p, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 id)
    {
        _validate(p);
        try IERC20Permit(p.token).permit(msg.sender, address(this), p.pool, deadline, v, r, s) {}
        catch {
            if (IERC20(p.token).allowance(msg.sender, address(this)) < p.pool) revert PermitFailed();
        }
        id = _create(p);
    }

    /// @notice Brand withdraws `pool − totalAllocated` (cap overflow + rounding dust) once the dispute window
    ///         is over. Callable once.
    function refundRemainder(uint256 id) external nonReentrant {
        Campaign storage c = _brandCampaign(id);
        if (c.rootPostedAt == 0) revert NoRoot();
        if (block.timestamp < _disputeEndsAt(c)) revert DisputeWindowActive();
        if (c.remainderRefunded) revert AlreadyRefunded();
        c.remainderRefunded = true;
        uint256 amount = uint256(c.pool) - c.totalAllocated;
        if (amount > 0) IERC20(c.token).safeTransfer(c.brand, amount);
        emit RemainderRefunded(id, c.brand, amount);
    }

    /// @notice Brand withdraws `totalAllocated − claimed` after the claim period ended. Callable once.
    function sweepUnclaimed(uint256 id) external nonReentrant {
        Campaign storage c = _brandCampaign(id);
        if (c.rootPostedAt == 0) revert NoRoot();
        if (block.timestamp < _claimDeadline(c)) revert ClaimPeriodActive();
        if (c.unclaimedSwept) revert AlreadySwept();
        c.unclaimedSwept = true;
        uint256 amount = uint256(c.totalAllocated) - c.claimed;
        if (amount > 0) IERC20(c.token).safeTransfer(c.brand, amount);
        emit UnclaimedSwept(id, c.brand, amount);
    }

    /// @notice Liveness refund: if no root (zero or not) is live after `snapshotTime + ROOT_DEADLINE`, the brand withdraws
    ///         everything left (`pool − claimed`). Marks the campaign refunded (`remainderRefunded` and
    ///         `unclaimedSwept` both set), so no root can be posted afterwards.
    function refundNoRoot(uint256 id) external nonReentrant {
        Campaign storage c = _brandCampaign(id);
        if (c.rootPostedAt != 0) revert RootAlreadyPosted();
        if (block.timestamp <= uint256(c.snapshotTime) + ROOT_DEADLINE) revert RootDeadlineNotPassed();
        if (c.remainderRefunded) revert AlreadyRefunded();
        c.remainderRefunded = true;
        c.unclaimedSwept = true;
        uint256 amount = uint256(c.pool) - c.claimed;
        IERC20(c.token).safeTransfer(c.brand, amount);
        emit NoRootRefunded(id, c.brand, amount);
    }

    // ────────────────────────────────────── Oracle / guardian ────────────────────────────────────

    /// @notice Post the payout Merkle root for a campaign. Opens the dispute window.
    /// @dev "Root posted" is tracked by `rootPostedAt != 0`, so a campaign with no valid submissions can be
    ///      finalized with `root = 0, totalAllocated = 0` (nothing claimable; `refundRemainder` returns the pool).
    /// @param root OZ StandardMerkleTree root over `(uint256 id, address account, uint256 amount)` leaves;
    ///        may be zero only if `totalAllocated == 0`.
    /// @param totalAllocated Sum of all leaf amounts; must be ≤ pool.
    /// @param snapshotHash Hash of the published snapshot file.
    function postRoot(uint256 id, bytes32 root, uint128 totalAllocated, bytes32 snapshotHash) external onlyOracle {
        Campaign storage c = _campaign(id);
        if (root == bytes32(0) && totalAllocated != 0) revert InvalidRoot();
        if (c.remainderRefunded) revert CampaignRefunded();
        if (c.rootPostedAt != 0) revert RootAlreadyPosted();
        if (block.timestamp < c.snapshotTime) revert SnapshotNotReached();
        if (block.timestamp > uint256(c.snapshotTime) + ROOT_DEADLINE) revert RootDeadlinePassed();
        if (totalAllocated > c.pool) revert AllocationExceedsPool();

        c.root = root;
        c.totalAllocated = totalAllocated;
        c.snapshotHash = snapshotHash;
        // casting to 'uint64' is safe because block timestamps fit in uint64 for billions of years
        // forge-lint: disable-next-line(unsafe-typecast)
        c.rootPostedAt = uint64(block.timestamp);
        // forge-lint: disable-next-line(unsafe-typecast)
        emit RootPosted(id, root, totalAllocated, snapshotHash, uint64(block.timestamp + _disputeWindow));
    }

    /// @notice Cancel the live root during its dispute window so the oracle can repost a corrected one.
    function cancelRoot(uint256 id) external onlyGuardian {
        Campaign storage c = _campaign(id);
        bytes32 root = c.root;
        if (c.rootPostedAt == 0) revert NoRoot();
        if (block.timestamp >= _disputeEndsAt(c)) revert DisputeWindowEnded();
        c.root = bytes32(0);
        c.totalAllocated = 0;
        c.snapshotHash = bytes32(0);
        c.rootPostedAt = 0;
        emit RootCancelled(id, root);
    }

    // ────────────────────────────────────────── Claims ───────────────────────────────────────────

    /// @notice Pay `amount` to `account` if `(id, account, amount)` is in the campaign's root. Anyone may call;
    ///         funds always go to `account`. Reverts on any failure (including the token transfer).
    function claim(uint256 id, address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Campaign storage c = _claimableCampaign(id);
        bytes4 err = _checkClaim(id, c, account, amount, proof);
        if (err != bytes4(0)) _revertWith(err);
        _markClaimed(id, c, account, amount);
        IERC20(c.token).safeTransfer(account, amount);
        emit Claimed(id, account, amount);
    }

    /// @notice Push many claims. Campaign-level conditions (exists, root live, window open) revert the batch;
    ///         per-item failures (zero account, already claimed, bad proof, over-allocation, token transfer
    ///         failure such as a blocklisted recipient) emit `ClaimFailed` and are skipped — a skipped item is
    ///         not marked claimed and can be retried.
    /// @return succeeded Number of items paid.
    function claimMany(uint256 id, Claim[] calldata claims) external nonReentrant returns (uint256 succeeded) {
        Campaign storage c = _claimableCampaign(id);
        address token = c.token;
        uint256 n = claims.length;
        for (uint256 i; i < n; ++i) {
            Claim calldata item = claims[i];
            bytes4 err = _checkClaim(id, c, item.account, item.amount, item.proof);
            if (err != bytes4(0)) {
                emit ClaimFailed(id, item.account, item.amount, abi.encodePacked(err));
                continue;
            }
            // Effects first; rolled back below if the transfer fails.
            _markClaimed(id, c, item.account, item.amount);
            (bool ok, bytes memory reason) = _tryTransfer(token, item.account, item.amount);
            if (ok) {
                ++succeeded;
                emit Claimed(id, item.account, item.amount);
            } else {
                _claimed[id][item.account] = false;
                // casting to 'uint128' is safe because the amount was just added via _markClaimed
                // forge-lint: disable-next-line(unsafe-typecast)
                c.claimed -= uint128(item.amount);
                emit ClaimFailed(id, item.account, item.amount, reason);
            }
        }
    }

    // ─────────────────────────────────────────── Views ───────────────────────────────────────────

    /// @notice Time after `postRoot` during which the guardian may cancel the root and claims are closed.
    ///         Fixed at deploy (mainnet 48 hours, testnet 10 minutes).
    // forge-lint: disable-next-line(mixed-case-function)
    function DISPUTE_WINDOW() public view returns (uint256) {
        return _disputeWindow;
    }

    /// @notice Minimum delay between `endTime` and `snapshotTime`. Fixed at deploy (mainnet 1 hours,
    ///         testnet 5 minutes).
    // forge-lint: disable-next-line(mixed-case-function)
    function MIN_MEASUREMENT_DELAY() public view returns (uint256) {
        return _minMeasurementDelay;
    }

    /// @notice Campaign state (alias of `getCampaign`). Returns an all-zero struct for unknown ids.
    function campaigns(uint256 id) external view returns (Campaign memory) {
        return _campaigns[id];
    }

    /// @notice Campaign state. Returns an all-zero struct for unknown ids.
    function getCampaign(uint256 id) external view returns (Campaign memory) {
        return _campaigns[id];
    }

    /// @notice Whether `account` has been paid for campaign `id`.
    function isClaimed(uint256 id, address account) external view returns (bool) {
        return _claimed[id][account];
    }

    /// @notice Binding code a creator puts in their video description: first 4 bytes of
    ///         `keccak256(abi.encodePacked(id, wallet))` (shown offchain as `cp-` + 8 hex chars).
    function bindingCode(uint256 id, address wallet) external pure returns (bytes4) {
        return bytes4(keccak256(abi.encodePacked(id, wallet)));
    }

    // ───────────────────────────────────────── Internals ─────────────────────────────────────────

    function _validate(CampaignParams calldata p) private view {
        if (!tokenAllowed[p.token]) revert TokenNotAllowed(p.token);
        if (p.pool == 0) revert InvalidPool();
        if (p.startTime >= p.endTime) revert InvalidTimes();
        if (p.measurementDelay < _minMeasurementDelay) revert InvalidMeasurementDelay();
        if (uint256(p.endTime) + p.measurementDelay > type(uint64).max) revert InvalidTimes();
        if (p.maxShareBps == 0 || p.maxShareBps > 10_000) revert InvalidMaxShare();
    }

    function _create(CampaignParams calldata p) private returns (uint256 id) {
        id = nextCampaignId++;
        uint64 snapshotTime = p.endTime + p.measurementDelay;
        Campaign storage c = _campaigns[id];
        c.brand = msg.sender;
        c.token = p.token;
        c.pool = p.pool;
        c.startTime = p.startTime;
        c.endTime = p.endTime;
        c.snapshotTime = snapshotTime;
        c.maxShareBps = p.maxShareBps;
        c.minViews = p.minViews;
        c.rulesHash = p.rulesHash;

        IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.pool);
        emit CampaignCreated(
            id,
            msg.sender,
            p.token,
            p.pool,
            p.startTime,
            p.endTime,
            snapshotTime,
            p.maxShareBps,
            p.minViews,
            p.rulesHash
        );
    }

    function _checkOracle() private view {
        if (msg.sender != oracle) revert NotOracle();
    }

    function _checkGuardian() private view {
        if (msg.sender != guardian) revert NotGuardian();
    }

    function _campaign(uint256 id) private view returns (Campaign storage c) {
        c = _campaigns[id];
        if (c.brand == address(0)) revert CampaignNotFound(id);
    }

    function _brandCampaign(uint256 id) private view returns (Campaign storage c) {
        c = _campaign(id);
        if (msg.sender != c.brand) revert NotBrand();
    }

    function _claimableCampaign(uint256 id) private view returns (Campaign storage c) {
        c = _campaign(id);
        if (c.rootPostedAt == 0) revert NoRoot();
        if (block.timestamp < _disputeEndsAt(c)) revert DisputeWindowActive();
        if (block.timestamp >= _claimDeadline(c)) revert ClaimPeriodEnded();
    }

    /// @dev Returns 0 if the claim is valid, else the selector of the error explaining why not.
    function _checkClaim(uint256 id, Campaign storage c, address account, uint256 amount, bytes32[] calldata proof)
        private
        view
        returns (bytes4)
    {
        if (account == address(0)) return ZeroAddress.selector;
        if (_claimed[id][account]) return AlreadyClaimed.selector;
        if (uint256(c.claimed) + amount > c.totalAllocated) return ExceedsAllocation.selector;
        // OZ StandardMerkleTree leaf (double-hashed); kept in Solidity for readability.
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(id, account, amount))));
        if (!MerkleProof.verifyCalldata(proof, c.root, leaf)) return InvalidProof.selector;
        return bytes4(0);
    }

    /// @dev Caller has checked `claimed + amount ≤ totalAllocated`, so the uint128 cast is safe.
    function _markClaimed(uint256 id, Campaign storage c, address account, uint256 amount) private {
        _claimed[id][account] = true;
        // casting to 'uint128' is safe because amount <= totalAllocated - claimed (checked by _checkClaim)
        // forge-lint: disable-next-line(unsafe-typecast)
        c.claimed += uint128(amount);
    }

    /// @dev ERC-20 transfer that never reverts; mirrors SafeERC20 semantics (revert or `false` = failure,
    ///      empty return data = success) and returns the revert data as the failure reason. The token is
    ///      allowlisted and already proved to have code when the campaign was funded.
    function _tryTransfer(address token, address to, uint256 amount) private returns (bool, bytes memory) {
        (bool success, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!success) return (false, ret);
        if (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (uint256)) == 1)) return (true, "");
        return (false, abi.encodeWithSelector(TransferFailed.selector));
    }

    function _revertWith(bytes4 err) private pure {
        assembly ("memory-safe") {
            mstore(0, err)
            revert(0, 4)
        }
    }

    function _disputeEndsAt(Campaign storage c) private view returns (uint256) {
        return uint256(c.rootPostedAt) + _disputeWindow;
    }

    function _claimDeadline(Campaign storage c) private view returns (uint256) {
        return uint256(c.rootPostedAt) + _disputeWindow + CLAIM_PERIOD;
    }
}
