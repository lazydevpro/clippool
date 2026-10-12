// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ClipPool} from "../src/ClipPool.sol";
import {BlocklistToken} from "./mocks/BlocklistToken.sol";
import {MockERC20Permit} from "./mocks/MockERC20Permit.sol";
import {Merkle} from "./utils/Merkle.sol";
import {ClipPoolBase} from "./utils/ClipPoolBase.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract ClipPoolTest is ClipPoolBase {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // ───────────────────────────── constructor / admin ─────────────────────────────

    function test_constructor_setsState() public view {
        assertEq(cp.owner(), owner);
        assertEq(cp.oracle(), oracle);
        assertEq(cp.guardian(), guardian);
        assertEq(cp.nextCampaignId(), 1);
        assertEq(cp.DISPUTE_WINDOW(), 48 hours);
        assertEq(cp.ROOT_DEADLINE(), 14 days);
        assertEq(cp.CLAIM_PERIOD(), 90 days);
        assertEq(cp.MIN_MEASUREMENT_DELAY(), 1 hours);
        assertTrue(cp.tokenAllowed(address(usdc)));
    }

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(ClipPool.ZeroAddress.selector);
        new ClipPool(owner, address(0), guardian, WINDOW, MIN_DELAY);
        vm.expectRevert(ClipPool.ZeroAddress.selector);
        new ClipPool(owner, oracle, address(0), WINDOW, MIN_DELAY);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ClipPool(address(0), oracle, guardian, WINDOW, MIN_DELAY);
    }

    function test_constructor_windowBounds() public {
        // dispute window: [5 minutes, 30 days]
        vm.expectRevert(abi.encodeWithSelector(ClipPool.InvalidDisputeWindow.selector, 5 minutes - 1));
        new ClipPool(owner, oracle, guardian, 5 minutes - 1, MIN_DELAY);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.InvalidDisputeWindow.selector, 0));
        new ClipPool(owner, oracle, guardian, 0, MIN_DELAY);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.InvalidDisputeWindow.selector, 30 days + 1));
        new ClipPool(owner, oracle, guardian, 30 days + 1, MIN_DELAY);
        // min measurement delay: [1 minutes, 30 days]
        vm.expectRevert(abi.encodeWithSelector(ClipPool.InvalidMinMeasurementDelay.selector, 1 minutes - 1));
        new ClipPool(owner, oracle, guardian, WINDOW, 1 minutes - 1);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.InvalidMinMeasurementDelay.selector, 0));
        new ClipPool(owner, oracle, guardian, WINDOW, 0);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.InvalidMinMeasurementDelay.selector, 30 days + 1));
        new ClipPool(owner, oracle, guardian, WINDOW, 30 days + 1);

        // inclusive bounds deploy fine
        ClipPool lo = new ClipPool(owner, oracle, guardian, 5 minutes, 1 minutes);
        assertEq(lo.DISPUTE_WINDOW(), 5 minutes);
        assertEq(lo.MIN_MEASUREMENT_DELAY(), 1 minutes);
        ClipPool hi = new ClipPool(owner, oracle, guardian, 30 days, 30 days);
        assertEq(hi.DISPUTE_WINDOW(), 30 days);
        assertEq(hi.MIN_MEASUREMENT_DELAY(), 30 days);
    }

    function testFuzz_constructor_gettersReturnConfigured(uint64 window, uint64 minDelay) public {
        window = uint64(bound(window, 5 minutes, 30 days));
        minDelay = uint64(bound(minDelay, 1 minutes, 30 days));
        ClipPool c = new ClipPool(owner, oracle, guardian, window, minDelay);
        assertEq(c.DISPUTE_WINDOW(), window);
        assertEq(c.MIN_MEASUREMENT_DELAY(), minDelay);
        assertEq(c.ROOT_DEADLINE(), 14 days);
        assertEq(c.CLAIM_PERIOD(), 90 days);
    }

    // ───────────────────────── short-window (testnet) deployment ─────────────────────────

    /// A testnet-style deployment (10 min dispute window, 5 min min delay): every boundary moves with the
    /// configured values.
    function test_shortWindow_lifecycleBoundaries() public {
        uint64 window = 10 minutes;
        uint64 minDelay = 5 minutes;
        ClipPool s = new ClipPool(owner, oracle, guardian, window, minDelay);
        vm.prank(owner);
        s.setTokenAllowed(address(usdc), true);
        vm.prank(brand);
        usdc.approve(address(s), type(uint256).max);

        ClipPool.CampaignParams memory p = _params(address(usdc), POOL);
        p.measurementDelay = minDelay - 1;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidMeasurementDelay.selector);
        s.createCampaign(p);
        p.measurementDelay = minDelay; // below the mainnet 1h minimum, accepted here
        vm.prank(brand);
        uint256 id = s.createCampaign(p);
        assertEq(s.getCampaign(id).snapshotTime, END + minDelay);

        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _leaves(id, a, m);
        bytes32 root = Merkle.root(leaves);
        vm.warp(END + minDelay);
        vm.expectEmit(address(s));
        emit ClipPool.RootPosted(id, root, 600e6, SNAP_HASH, END + minDelay + window);
        vm.prank(oracle);
        s.postRoot(id, root, 600e6, SNAP_HASH);
        uint256 postedAt = s.getCampaign(id).rootPostedAt;

        // last second of the window: claims closed, cancel still possible (checked via a snapshot)
        vm.warp(postedAt + window - 1);
        bytes32[] memory proof0 = Merkle.proof(leaves, 0);
        vm.expectRevert(ClipPool.DisputeWindowActive.selector);
        s.claim(id, alice, 200e6, proof0);
        vm.prank(brand);
        vm.expectRevert(ClipPool.DisputeWindowActive.selector);
        s.refundRemainder(id);
        uint256 snap = vm.snapshotState();
        vm.prank(guardian);
        s.cancelRoot(id);
        assertEq(s.getCampaign(id).rootPostedAt, 0);
        vm.revertToState(snap);

        // exactly rootPostedAt + 10 min: claims open, cancelRoot closed
        vm.warp(postedAt + window);
        vm.prank(guardian);
        vm.expectRevert(ClipPool.DisputeWindowEnded.selector);
        s.cancelRoot(id);
        s.claim(id, alice, 200e6, proof0);
        assertEq(usdc.balanceOf(alice), 200e6);
        vm.prank(brand);
        s.refundRemainder(id);

        // claim period is still the 90-day constant after the short window
        vm.warp(postedAt + window + 90 days - 1);
        s.claim(id, bob, 300e6, Merkle.proof(leaves, 1));
        vm.warp(postedAt + window + 90 days);
        bytes32[] memory proof2 = Merkle.proof(leaves, 2);
        vm.expectRevert(ClipPool.ClaimPeriodEnded.selector);
        s.claim(id, carol, 100e6, proof2);
    }

    function test_admin_setters() public {
        address n = makeAddr("new");
        vm.startPrank(owner);
        vm.expectEmit(address(cp));
        emit ClipPool.OracleSet(n);
        cp.setOracle(n);
        vm.expectEmit(address(cp));
        emit ClipPool.GuardianSet(n);
        cp.setGuardian(n);
        vm.expectEmit(address(cp));
        emit ClipPool.TokenAllowedSet(address(usdc), false);
        cp.setTokenAllowed(address(usdc), false);
        vm.stopPrank();
        assertEq(cp.oracle(), n);
        assertEq(cp.guardian(), n);
        assertFalse(cp.tokenAllowed(address(usdc)));
    }

    function test_admin_revertsForNonOwner() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        cp.setOracle(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        cp.setGuardian(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        cp.setTokenAllowed(alice, true);
        vm.stopPrank();
    }

    function test_admin_revertsOnZeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(ClipPool.ZeroAddress.selector);
        cp.setOracle(address(0));
        vm.expectRevert(ClipPool.ZeroAddress.selector);
        cp.setGuardian(address(0));
        vm.expectRevert(ClipPool.ZeroAddress.selector);
        cp.setTokenAllowed(address(0), true);
        vm.stopPrank();
    }

    function test_ownable2Step() public {
        vm.prank(owner);
        cp.transferOwnership(alice);
        assertEq(cp.owner(), owner);
        assertEq(cp.pendingOwner(), alice);
        vm.prank(alice);
        cp.acceptOwnership();
        assertEq(cp.owner(), alice);
    }

    // ─────────────────────────────────── create ────────────────────────────────────

    function test_create_storesCampaignAndPulls() public {
        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(address(cp));
        emit ClipPool.CampaignCreated(1, brand, address(usdc), POOL, START, END, SNAPSHOT, 2000, 1000, RULES);
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(cp.nextCampaignId(), 2);
        assertEq(usdc.balanceOf(address(cp)), POOL);
        assertEq(usdc.balanceOf(brand), before - POOL);

        ClipPool.Campaign memory c = cp.getCampaign(id);
        assertEq(c.brand, brand);
        assertEq(c.token, address(usdc));
        assertEq(c.pool, POOL);
        assertEq(c.totalAllocated, 0);
        assertEq(c.claimed, 0);
        assertEq(c.startTime, START);
        assertEq(c.endTime, END);
        assertEq(c.snapshotTime, SNAPSHOT);
        assertEq(c.rootPostedAt, 0);
        assertEq(c.maxShareBps, 2000);
        assertEq(c.minViews, 1000);
        assertEq(c.rulesHash, RULES);
        assertEq(c.root, bytes32(0));
        assertEq(c.snapshotHash, bytes32(0));
        assertFalse(c.remainderRefunded);
        assertFalse(c.unclaimedSwept);

        assertEq(_create(), 2);
        assertEq(cp.nextCampaignId(), 3);
    }

    function test_create_boundaryParamsAccepted() public {
        ClipPool.CampaignParams memory p = _params(address(usdc), 1);
        p.measurementDelay = 1 hours;
        p.maxShareBps = 1;
        p.endTime = p.startTime + 1;
        vm.prank(brand);
        uint256 id = cp.createCampaign(p);
        assertEq(cp.getCampaign(id).snapshotTime, p.endTime + 1 hours);

        p.maxShareBps = 10_000;
        vm.prank(brand);
        cp.createCampaign(p);
    }

    function test_create_reverts_tokenNotAllowed() public {
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.TokenNotAllowed.selector, alice));
        cp.createCampaign(_params(alice, POOL));
    }

    function test_create_reverts_zeroPool() public {
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidPool.selector);
        cp.createCampaign(_params(address(usdc), 0));
    }

    function test_create_reverts_badTimes() public {
        ClipPool.CampaignParams memory p = _params(address(usdc), POOL);
        p.endTime = p.startTime;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidTimes.selector);
        cp.createCampaign(p);

        p.endTime = p.startTime - 1;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidTimes.selector);
        cp.createCampaign(p);

        // snapshotTime would overflow uint64
        p.endTime = type(uint64).max - 10;
        p.measurementDelay = 1 hours;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidTimes.selector);
        cp.createCampaign(p);
    }

    function test_create_reverts_shortDelay() public {
        ClipPool.CampaignParams memory p = _params(address(usdc), POOL);
        p.measurementDelay = 1 hours - 1;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidMeasurementDelay.selector);
        cp.createCampaign(p);
    }

    function test_create_reverts_badMaxShare() public {
        ClipPool.CampaignParams memory p = _params(address(usdc), POOL);
        p.maxShareBps = 0;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidMaxShare.selector);
        cp.createCampaign(p);
        p.maxShareBps = 10_001;
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidMaxShare.selector);
        cp.createCampaign(p);
    }

    function test_create_reverts_noAllowance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(cp), 0, POOL));
        cp.createCampaign(_params(address(usdc), POOL));
    }

    // ─────────────────────────────────── permit ────────────────────────────────────

    function _permitSig(MockERC20Permit token, uint256 pk, address owner_, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner_, address(cp), value, token.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _freshBrand() internal returns (address b, uint256 pk) {
        (b, pk) = makeAddrAndKey("brand2");
        usdc.mint(b, POOL);
    }

    function test_permit_createsInOneTx() public {
        (address b, uint256 pk) = _freshBrand();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(usdc, pk, b, POOL, deadline);
        vm.prank(b);
        uint256 id = cp.createCampaignWithPermit(_params(address(usdc), POOL), deadline, v, r, s);
        assertEq(cp.getCampaign(id).brand, b);
        assertEq(usdc.balanceOf(address(cp)), POOL);
        assertEq(usdc.balanceOf(b), 0);
        assertEq(usdc.nonces(b), 1);
    }

    function test_permit_frontRunStillSucceeds() public {
        (address b, uint256 pk) = _freshBrand();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(usdc, pk, b, POOL, deadline);
        // attacker submits the permit first, consuming the nonce
        vm.prank(alice);
        usdc.permit(b, address(cp), POOL, deadline, v, r, s);
        vm.prank(b);
        uint256 id = cp.createCampaignWithPermit(_params(address(usdc), POOL), deadline, v, r, s);
        assertEq(cp.getCampaign(id).pool, POOL);
        assertEq(usdc.balanceOf(address(cp)), POOL);
    }

    function test_permit_invalidSigButApproved() public {
        (address b,) = _freshBrand();
        vm.prank(b);
        usdc.approve(address(cp), POOL);
        vm.prank(b);
        uint256 id =
            cp.createCampaignWithPermit(_params(address(usdc), POOL), block.timestamp, 27, bytes32(0), bytes32(0));
        assertEq(cp.getCampaign(id).brand, b);
    }

    function test_permit_reverts_invalidSigNoAllowance() public {
        (address b, uint256 pk) = _freshBrand();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(usdc, pk, b, POOL - 1, deadline); // signed wrong value
        vm.prank(b);
        vm.expectRevert(ClipPool.PermitFailed.selector);
        cp.createCampaignWithPermit(_params(address(usdc), POOL), deadline, v, r, s);
    }

    function test_permit_reverts_expired() public {
        (address b, uint256 pk) = _freshBrand();
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(usdc, pk, b, POOL, deadline);
        vm.prank(b);
        vm.expectRevert(ClipPool.PermitFailed.selector);
        cp.createCampaignWithPermit(_params(address(usdc), POOL), deadline, v, r, s);
    }

    function test_permit_reverts_invalidParamsBeforePermit() public {
        vm.prank(brand);
        vm.expectRevert(ClipPool.InvalidPool.selector);
        cp.createCampaignWithPermit(_params(address(usdc), 0), block.timestamp, 0, 0, 0);
    }

    // ────────────────────────────────── postRoot ───────────────────────────────────

    function test_postRoot_success() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        bytes32 root = keccak256("root");
        vm.expectEmit(address(cp));
        emit ClipPool.RootPosted(id, root, 600e6, SNAP_HASH, SNAPSHOT + 48 hours);
        vm.prank(oracle);
        cp.postRoot(id, root, 600e6, SNAP_HASH);
        ClipPool.Campaign memory c = cp.getCampaign(id);
        assertEq(c.root, root);
        assertEq(c.totalAllocated, 600e6);
        assertEq(c.snapshotHash, SNAP_HASH);
        assertEq(c.rootPostedAt, SNAPSHOT);
    }

    function test_postRoot_reverts_notOracle() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.prank(alice);
        vm.expectRevert(ClipPool.NotOracle.selector);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);
    }

    function test_postRoot_reverts_unknownCampaign() public {
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.CampaignNotFound.selector, 7));
        cp.postRoot(7, keccak256("r"), 1, SNAP_HASH);
    }

    function test_postRoot_reverts_zeroRootWithAllocation() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.prank(oracle);
        vm.expectRevert(ClipPool.InvalidRoot.selector);
        cp.postRoot(id, bytes32(0), 1, SNAP_HASH);
    }

    /// @dev No valid submissions: oracle finalizes with root 0 / total 0; nothing is claimable; the brand
    ///      gets the full pool back via refundRemainder after the dispute window.
    function test_zeroAllocation_finalizeAndRefund() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.expectEmit(address(cp));
        emit ClipPool.RootPosted(id, bytes32(0), 0, SNAP_HASH, SNAPSHOT + 48 hours);
        vm.prank(oracle);
        cp.postRoot(id, bytes32(0), 0, SNAP_HASH);
        assertEq(cp.getCampaign(id).rootPostedAt, SNAPSHOT);

        // counts as posted: no repost, no liveness refund
        vm.prank(oracle);
        vm.expectRevert(ClipPool.RootAlreadyPosted.selector);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);

        _warpPastDispute(id);
        bytes32[] memory p;
        vm.expectRevert(ClipPool.ExceedsAllocation.selector);
        cp.claim(id, alice, 1, p);
        vm.expectRevert(ClipPool.InvalidProof.selector);
        cp.claim(id, alice, 0, p);

        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(address(cp));
        emit ClipPool.RemainderRefunded(id, brand, POOL);
        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(usdc.balanceOf(brand) - before, POOL);
        assertEq(usdc.balanceOf(address(cp)), 0);

        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(brand);
        vm.expectRevert(ClipPool.RootAlreadyPosted.selector);
        cp.refundNoRoot(id);
    }

    function test_zeroAllocation_cancelThenRepost() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.prank(oracle);
        cp.postRoot(id, bytes32(0), 0, SNAP_HASH);
        vm.expectEmit(address(cp));
        emit ClipPool.RootCancelled(id, bytes32(0));
        vm.prank(guardian);
        cp.cancelRoot(id);
        assertEq(cp.getCampaign(id).rootPostedAt, 0);
        vm.prank(oracle);
        cp.postRoot(id, keccak256("fixed"), 10e6, SNAP_HASH);
        assertEq(cp.getCampaign(id).totalAllocated, 10e6);
    }

    function test_postRoot_timeBoundaries() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT - 1);
        vm.prank(oracle);
        vm.expectRevert(ClipPool.SnapshotNotReached.selector);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);

        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(oracle);
        vm.expectRevert(ClipPool.RootDeadlinePassed.selector);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);

        vm.warp(uint256(SNAPSHOT) + 14 days); // last valid second
        vm.prank(oracle);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);
    }

    function test_postRoot_reverts_exceedsPool() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.prank(oracle);
        vm.expectRevert(ClipPool.AllocationExceedsPool.selector);
        cp.postRoot(id, keccak256("r"), POOL + 1, SNAP_HASH);
        vm.prank(oracle);
        cp.postRoot(id, keccak256("r"), POOL, SNAP_HASH); // exactly pool is fine
    }

    function test_postRoot_reverts_liveRoot() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.startPrank(oracle);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);
        vm.expectRevert(ClipPool.RootAlreadyPosted.selector);
        cp.postRoot(id, keccak256("r2"), 1, SNAP_HASH);
        vm.stopPrank();
    }

    function test_postRoot_reverts_afterNoRootRefund() public {
        uint256 id = _create();
        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(brand);
        cp.refundNoRoot(id);
        vm.prank(oracle);
        vm.expectRevert(ClipPool.CampaignRefunded.selector);
        cp.postRoot(id, keccak256("r"), 1, SNAP_HASH);
    }

    // ───────────────────────────────── cancelRoot ──────────────────────────────────

    function test_cancelRoot_insideWindowClearsRoot() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        bytes32 root = Merkle.root(leaves);
        vm.warp(block.timestamp + 48 hours - 1); // last second of the window
        vm.expectEmit(address(cp));
        emit ClipPool.RootCancelled(id, root);
        vm.prank(guardian);
        cp.cancelRoot(id);
        ClipPool.Campaign memory c = cp.getCampaign(id);
        assertEq(c.root, bytes32(0));
        assertEq(c.totalAllocated, 0);
        assertEq(c.snapshotHash, bytes32(0));
        assertEq(c.rootPostedAt, 0);
    }

    function test_cancelRoot_reverts_atWindowEnd() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        _postRoot(id, a, m);
        _warpPastDispute(id);
        vm.prank(guardian);
        vm.expectRevert(ClipPool.DisputeWindowEnded.selector);
        cp.cancelRoot(id);
    }

    function test_cancelRoot_reverts_access() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(ClipPool.NotGuardian.selector);
        cp.cancelRoot(id);
        vm.prank(guardian);
        vm.expectRevert(ClipPool.NoRoot.selector);
        cp.cancelRoot(id);
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.CampaignNotFound.selector, 99));
        cp.cancelRoot(99);
    }

    function test_cancelRoot_thenRepost() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory badLeaves = _postRoot(id, a, m);
        vm.prank(guardian);
        cp.cancelRoot(id);

        // corrected allocation: bob gets more
        m[1] = 400e6;
        vm.warp(block.timestamp + 1 hours);
        bytes32[] memory leaves = _postRoot(id, a, m);
        assertEq(cp.getCampaign(id).totalAllocated, 700e6);
        assertEq(cp.getCampaign(id).rootPostedAt, block.timestamp);
        _warpPastDispute(id);

        // old proof for bob's old amount fails
        vm.expectRevert(ClipPool.InvalidProof.selector);
        cp.claim(id, bob, 300e6, Merkle.proof(badLeaves, 1));
        cp.claim(id, bob, 400e6, Merkle.proof(leaves, 1));
        assertEq(usdc.balanceOf(bob), 400e6);
    }

    // ──────────────────────────────────── claim ────────────────────────────────────

    function test_claim_success() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id); // exactly at disputeEndsAt
        vm.expectEmit(address(cp));
        emit ClipPool.Claimed(id, alice, 200e6);
        vm.prank(keeper);
        cp.claim(id, alice, 200e6, Merkle.proof(leaves, 0));
        assertEq(usdc.balanceOf(alice), 200e6);
        assertTrue(cp.isClaimed(id, alice));
        assertFalse(cp.isClaimed(id, bob));
        assertEq(cp.getCampaign(id).claimed, 200e6);
    }

    function test_claim_reverts_insideDisputeWindow() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        vm.warp(block.timestamp + 48 hours - 1);
        bytes32[] memory p = Merkle.proof(leaves, 0);
        vm.expectRevert(ClipPool.DisputeWindowActive.selector);
        cp.claim(id, alice, 200e6, p);
    }

    function test_claim_claimPeriodBoundaries() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        uint256 deadline = _claimDeadline(id);
        vm.warp(deadline - 1);
        cp.claim(id, alice, 200e6, Merkle.proof(leaves, 0));
        vm.warp(deadline);
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.expectRevert(ClipPool.ClaimPeriodEnded.selector);
        cp.claim(id, bob, 300e6, p);
    }

    function test_claim_reverts_noRootOrUnknown() public {
        uint256 id = _create();
        bytes32[] memory p;
        vm.expectRevert(ClipPool.NoRoot.selector);
        cp.claim(id, alice, 1, p);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.CampaignNotFound.selector, 5));
        cp.claim(5, alice, 1, p);
    }

    function test_claim_reverts_doubleClaim() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        bytes32[] memory p = Merkle.proof(leaves, 2);
        cp.claim(id, carol, 100e6, p);
        vm.expectRevert(ClipPool.AlreadyClaimed.selector);
        cp.claim(id, carol, 100e6, p);
    }

    function test_claim_reverts_invalidProof() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        bytes32[] memory p = Merkle.proof(leaves, 0);
        vm.expectRevert(ClipPool.InvalidProof.selector);
        cp.claim(id, alice, 200e6 + 1, p); // wrong amount
        vm.expectRevert(ClipPool.InvalidProof.selector);
        cp.claim(id, bob, 200e6, p); // wrong account
    }

    function test_claim_reverts_zeroAccountEvenIfInTree() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        a[2] = address(0);
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        bytes32[] memory p = Merkle.proof(leaves, 2);
        vm.expectRevert(ClipPool.ZeroAddress.selector);
        cp.claim(id, address(0), 100e6, p);
    }

    function test_claim_reverts_exceedsTotalAllocated() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _leaves(id, a, m);
        vm.warp(SNAPSHOT);
        vm.prank(oracle); // buggy oracle: tree sums to 600 but totalAllocated says 250
        cp.postRoot(id, Merkle.root(leaves), 250e6, SNAP_HASH);
        _warpPastDispute(id);
        cp.claim(id, alice, 200e6, Merkle.proof(leaves, 0));
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.expectRevert(ClipPool.ExceedsAllocation.selector);
        cp.claim(id, bob, 300e6, p);
    }

    function test_claim_crossCampaignReplayRejected() public {
        uint256 id1 = _create();
        uint256 id2 = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id1, a, m);
        // oracle (mistakenly or maliciously) posts campaign 1's root to campaign 2
        vm.prank(oracle);
        cp.postRoot(id2, Merkle.root(leaves), 600e6, SNAP_HASH);
        _warpPastDispute(id2);
        bytes32[] memory p = Merkle.proof(leaves, 0);
        cp.claim(id1, alice, 200e6, p);
        vm.expectRevert(ClipPool.InvalidProof.selector);
        cp.claim(id2, alice, 200e6, p);
    }

    function test_claim_blocklistedRevertsAndStaysUnclaimed() public {
        uint256 id = _create(address(btoken), POOL);
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        btoken.setBlocked(bob, true);
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, bob));
        cp.claim(id, bob, 300e6, p);
        assertFalse(cp.isClaimed(id, bob));
        assertEq(cp.getCampaign(id).claimed, 0);
    }

    function test_claim_singleLeafTree() public {
        uint256 id = _create();
        address[] memory a = new address[](1);
        uint256[] memory m = new uint256[](1);
        a[0] = alice;
        m[0] = POOL;
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        cp.claim(id, alice, POOL, Merkle.proof(leaves, 0));
        assertEq(usdc.balanceOf(alice), POOL);
        assertEq(usdc.balanceOf(address(cp)), 0);
    }

    // ────────────────────────────────── claimMany ──────────────────────────────────

    function _batch(uint256 id, address[] memory a, uint256[] memory m, bytes32[] memory leaves)
        internal
        pure
        returns (ClipPool.Claim[] memory claims)
    {
        id;
        claims = new ClipPool.Claim[](a.length);
        for (uint256 i; i < a.length; ++i) {
            claims[i] = ClipPool.Claim({account: a[i], amount: m[i], proof: Merkle.proof(leaves, i)});
        }
    }

    function test_claimMany_allSucceed() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        vm.prank(keeper);
        uint256 ok = cp.claimMany(id, _batch(id, a, m, leaves));
        assertEq(ok, 3);
        assertEq(usdc.balanceOf(alice), 200e6);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(carol), 100e6);
        assertEq(cp.getCampaign(id).claimed, 600e6);
    }

    function test_claimMany_blocklistedMiddleIsIsolated() public {
        uint256 id = _create(address(btoken), POOL);
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        btoken.setBlocked(bob, true);

        vm.expectEmit(address(cp));
        emit ClipPool.Claimed(id, alice, 200e6);
        vm.expectEmit(address(cp));
        emit ClipPool.ClaimFailed(id, bob, 300e6, abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, bob));
        vm.expectEmit(address(cp));
        emit ClipPool.Claimed(id, carol, 100e6);
        uint256 ok = cp.claimMany(id, _batch(id, a, m, leaves));

        assertEq(ok, 2);
        assertEq(btoken.balanceOf(alice), 200e6);
        assertEq(btoken.balanceOf(bob), 0);
        assertEq(btoken.balanceOf(carol), 100e6);
        assertFalse(cp.isClaimed(id, bob));
        assertEq(cp.getCampaign(id).claimed, 300e6);
        assertEq(btoken.balanceOf(address(cp)), POOL - 300e6);

        // once unblocked, bob's claim goes through
        btoken.setBlocked(bob, false);
        cp.claim(id, bob, 300e6, Merkle.proof(leaves, 1));
        assertEq(btoken.balanceOf(bob), 300e6);
    }

    function test_claimMany_returnFalseTokenIsIsolated() public {
        uint256 id = _create(address(btoken), POOL);
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        btoken.setBlocked(bob, true);
        btoken.setReturnFalse(true);
        vm.expectEmit(address(cp));
        emit ClipPool.ClaimFailed(id, bob, 300e6, abi.encodeWithSelector(ClipPool.TransferFailed.selector));
        uint256 ok = cp.claimMany(id, _batch(id, a, m, leaves));
        assertEq(ok, 2);
        assertFalse(cp.isClaimed(id, bob));
    }

    function test_claimMany_perItemValidationFailures() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        ClipPool.Claim[] memory base = _batch(id, a, m, leaves);

        ClipPool.Claim[] memory claims = new ClipPool.Claim[](5);
        claims[0] = base[0];
        claims[1] = base[0]; // duplicate in same batch
        claims[2] = ClipPool.Claim({account: bob, amount: 1, proof: base[1].proof}); // bad proof
        claims[3] = ClipPool.Claim({account: address(0), amount: 1, proof: base[1].proof}); // zero account
        claims[4] = base[2];

        vm.expectEmit(address(cp));
        emit ClipPool.Claimed(id, alice, 200e6);
        vm.expectEmit(address(cp));
        emit ClipPool.ClaimFailed(id, alice, 200e6, abi.encodePacked(ClipPool.AlreadyClaimed.selector));
        vm.expectEmit(address(cp));
        emit ClipPool.ClaimFailed(id, bob, 1, abi.encodePacked(ClipPool.InvalidProof.selector));
        vm.expectEmit(address(cp));
        emit ClipPool.ClaimFailed(id, address(0), 1, abi.encodePacked(ClipPool.ZeroAddress.selector));
        vm.expectEmit(address(cp));
        emit ClipPool.Claimed(id, carol, 100e6);
        assertEq(cp.claimMany(id, claims), 2);
        assertEq(cp.getCampaign(id).claimed, 300e6);
    }

    function test_claimMany_exceedsAllocationItemSkipped() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _leaves(id, a, m);
        vm.warp(SNAPSHOT);
        vm.prank(oracle);
        cp.postRoot(id, Merkle.root(leaves), 300e6, SNAP_HASH);
        _warpPastDispute(id);
        vm.expectEmit(address(cp));
        emit ClipPool.ClaimFailed(id, bob, 300e6, abi.encodePacked(ClipPool.ExceedsAllocation.selector));
        assertEq(cp.claimMany(id, _batch(id, a, m, leaves)), 2); // alice 200 + carol 100 = 300
        assertEq(cp.getCampaign(id).claimed, 300e6);
    }

    function test_claimMany_campaignLevelReverts() public {
        uint256 id = _create();
        ClipPool.Claim[] memory none = new ClipPool.Claim[](0);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.CampaignNotFound.selector, 9));
        cp.claimMany(9, none);
        vm.expectRevert(ClipPool.NoRoot.selector);
        cp.claimMany(id, none);

        (address[] memory a, uint256[] memory m) = _abc();
        _postRoot(id, a, m);
        vm.expectRevert(ClipPool.DisputeWindowActive.selector);
        cp.claimMany(id, none);

        vm.warp(_claimDeadline(id));
        vm.expectRevert(ClipPool.ClaimPeriodEnded.selector);
        cp.claimMany(id, none);
    }

    function test_claimMany_empty() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        _postRoot(id, a, m);
        _warpPastDispute(id);
        assertEq(cp.claimMany(id, new ClipPool.Claim[](0)), 0);
    }

    // ────────────────────────────────── refunds ────────────────────────────────────

    function test_refundRemainder() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        _postRoot(id, a, m);

        vm.prank(alice);
        vm.expectRevert(ClipPool.NotBrand.selector);
        cp.refundRemainder(id);

        vm.warp(block.timestamp + 48 hours - 1);
        vm.prank(brand);
        vm.expectRevert(ClipPool.DisputeWindowActive.selector);
        cp.refundRemainder(id);

        _warpPastDispute(id);
        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(address(cp));
        emit ClipPool.RemainderRefunded(id, brand, 400e6);
        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(usdc.balanceOf(brand), before + 400e6);
        assertTrue(cp.getCampaign(id).remainderRefunded);

        vm.prank(brand);
        vm.expectRevert(ClipPool.AlreadyRefunded.selector);
        cp.refundRemainder(id);
    }

    function test_refundRemainder_zeroAmount() public {
        uint256 id = _create();
        vm.warp(SNAPSHOT);
        vm.prank(oracle);
        cp.postRoot(id, keccak256("r"), POOL, SNAP_HASH);
        _warpPastDispute(id);
        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(address(cp));
        emit ClipPool.RemainderRefunded(id, brand, 0);
        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(usdc.balanceOf(brand), before);
    }

    function test_refundRemainder_reverts_noRootOrUnknown() public {
        uint256 id = _create();
        vm.prank(brand);
        vm.expectRevert(ClipPool.NoRoot.selector);
        cp.refundRemainder(id);
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.CampaignNotFound.selector, 3));
        cp.refundRemainder(3);
    }

    function test_sweepUnclaimed() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        cp.claim(id, alice, 200e6, Merkle.proof(leaves, 0));

        vm.prank(brand);
        vm.expectRevert(ClipPool.ClaimPeriodActive.selector);
        cp.sweepUnclaimed(id);

        vm.warp(_claimDeadline(id) - 1);
        vm.prank(brand);
        vm.expectRevert(ClipPool.ClaimPeriodActive.selector);
        cp.sweepUnclaimed(id);

        vm.warp(_claimDeadline(id));
        vm.prank(alice);
        vm.expectRevert(ClipPool.NotBrand.selector);
        cp.sweepUnclaimed(id);

        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(address(cp));
        emit ClipPool.UnclaimedSwept(id, brand, 400e6);
        vm.prank(brand);
        cp.sweepUnclaimed(id);
        assertEq(usdc.balanceOf(brand), before + 400e6);
        assertTrue(cp.getCampaign(id).unclaimedSwept);

        vm.prank(brand);
        vm.expectRevert(ClipPool.AlreadySwept.selector);
        cp.sweepUnclaimed(id);

        // remainder still refundable after the sweep; contract ends empty
        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(usdc.balanceOf(address(cp)), 0);

        // claims are closed
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.expectRevert(ClipPool.ClaimPeriodEnded.selector);
        cp.claim(id, bob, 300e6, p);
    }

    function test_sweepUnclaimed_zeroWhenAllClaimed() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        cp.claimMany(id, _batch(id, a, m, leaves));
        vm.warp(_claimDeadline(id));
        vm.expectEmit(address(cp));
        emit ClipPool.UnclaimedSwept(id, brand, 0);
        vm.prank(brand);
        cp.sweepUnclaimed(id);
    }

    function test_sweepUnclaimed_reverts_noRoot() public {
        uint256 id = _create();
        vm.prank(brand);
        vm.expectRevert(ClipPool.NoRoot.selector);
        cp.sweepUnclaimed(id);
    }

    function test_refundNoRoot() public {
        uint256 id = _create();
        vm.warp(uint256(SNAPSHOT) + 14 days); // deadline not yet passed
        vm.prank(brand);
        vm.expectRevert(ClipPool.RootDeadlineNotPassed.selector);
        cp.refundNoRoot(id);

        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(alice);
        vm.expectRevert(ClipPool.NotBrand.selector);
        cp.refundNoRoot(id);

        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(address(cp));
        emit ClipPool.NoRootRefunded(id, brand, POOL);
        vm.prank(brand);
        cp.refundNoRoot(id);
        assertEq(usdc.balanceOf(brand), before + POOL);
        assertEq(usdc.balanceOf(address(cp)), 0);
        ClipPool.Campaign memory c = cp.getCampaign(id);
        assertTrue(c.remainderRefunded);
        assertTrue(c.unclaimedSwept);

        vm.prank(brand);
        vm.expectRevert(ClipPool.AlreadyRefunded.selector);
        cp.refundNoRoot(id);
        vm.prank(brand);
        vm.expectRevert(ClipPool.NoRoot.selector);
        cp.refundRemainder(id);
    }

    function test_refundNoRoot_reverts_rootLive() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        _postRoot(id, a, m);
        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(brand);
        vm.expectRevert(ClipPool.RootAlreadyPosted.selector);
        cp.refundNoRoot(id);
    }

    function test_refundNoRoot_afterCancelAndMissedDeadline() public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        _postRoot(id, a, m);
        vm.prank(guardian);
        cp.cancelRoot(id);
        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(oracle);
        vm.expectRevert(ClipPool.RootDeadlinePassed.selector);
        cp.postRoot(id, keccak256("late"), 1, SNAP_HASH);
        vm.prank(brand);
        cp.refundNoRoot(id);
        assertEq(usdc.balanceOf(address(cp)), 0);
    }

    function test_refundNoRoot_reverts_unknown() public {
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(ClipPool.CampaignNotFound.selector, 1));
        cp.refundNoRoot(1);
    }

    function test_multiCampaignAccountingIsolated() public {
        uint256 id1 = _create();
        uint256 id2 = _create(address(usdc), 500e6);
        (address[] memory a, uint256[] memory m) = _abc();
        bytes32[] memory l1 = _postRoot(id1, a, m);
        _warpPastDispute(id1);
        cp.claimMany(id1, _batch(id1, a, m, l1));
        vm.prank(brand);
        cp.refundRemainder(id1);
        // campaign 2 funds are untouched
        assertEq(usdc.balanceOf(address(cp)), 500e6);
        vm.warp(uint256(SNAPSHOT) + 14 days + 1);
        vm.prank(brand);
        cp.refundNoRoot(id2);
        assertEq(usdc.balanceOf(address(cp)), 0);
    }

    // ─────────────────────────────────── views ─────────────────────────────────────

    function test_views() public {
        uint256 id = _create();
        ClipPool.Campaign memory a = cp.getCampaign(id);
        ClipPool.Campaign memory b = cp.campaigns(id);
        assertEq(keccak256(abi.encode(a)), keccak256(abi.encode(b)));
        assertEq(cp.getCampaign(42).brand, address(0));
        assertFalse(cp.isClaimed(id, alice));
    }

    function test_bindingCode() public view {
        address w = 0x1111111111111111111111111111111111111111;
        assertEq(cp.bindingCode(1, w), bytes4(keccak256(abi.encodePacked(uint256(1), w))));
        // fixed vector: cast keccak $(cast concat-hex $(cast to-uint256 1) 0x1111…1111)
        assertEq(cp.bindingCode(1, w), BINDING_VECTOR);
    }

    bytes4 internal constant BINDING_VECTOR = 0xf3a32c19; // "cp-f3a32c19"
}
