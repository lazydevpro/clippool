// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClipPool} from "../../src/ClipPool.sol";
import {MockERC20Permit} from "../mocks/MockERC20Permit.sol";
import {BlocklistToken} from "../mocks/BlocklistToken.sol";
import {Merkle} from "./Merkle.sol";

abstract contract ClipPoolBase is Test {
    ClipPool internal cp;
    MockERC20Permit internal usdc;
    BlocklistToken internal btoken;

    address internal owner = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal brand;
    uint256 internal brandPk;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint64 internal constant WINDOW = 48 hours; // mainnet dispute window
    uint64 internal constant MIN_DELAY = 1 hours; // mainnet minimum measurement delay
    uint64 internal constant START = 1_000_000;
    uint64 internal constant END = START + 7 days;
    uint64 internal constant DELAY = 7 days;
    uint64 internal constant SNAPSHOT = END + DELAY;
    uint128 internal constant POOL = 1_000e6;
    bytes32 internal constant RULES = keccak256("rules v1");
    bytes32 internal constant SNAP_HASH = keccak256("snapshot.json");

    function setUp() public virtual {
        vm.warp(START);
        (brand, brandPk) = makeAddrAndKey("brand");
        cp = new ClipPool(owner, oracle, guardian, WINDOW, MIN_DELAY);
        usdc = new MockERC20Permit("USD Coin", "USDC");
        btoken = new BlocklistToken();
        vm.startPrank(owner);
        cp.setTokenAllowed(address(usdc), true);
        cp.setTokenAllowed(address(btoken), true);
        vm.stopPrank();

        usdc.mint(brand, 1_000_000e6);
        btoken.mint(brand, 1_000_000e6);
        vm.startPrank(brand);
        usdc.approve(address(cp), type(uint256).max);
        btoken.approve(address(cp), type(uint256).max);
        vm.stopPrank();
    }

    function _params(address token, uint128 amount) internal pure returns (ClipPool.CampaignParams memory p) {
        p = ClipPool.CampaignParams({
            token: token,
            pool: amount,
            startTime: START,
            endTime: END,
            measurementDelay: DELAY,
            maxShareBps: 2000,
            minViews: 1000,
            rulesHash: RULES
        });
    }

    function _create() internal returns (uint256) {
        return _create(address(usdc), POOL);
    }

    function _create(address token, uint128 amount) internal returns (uint256 id) {
        vm.prank(brand);
        id = cp.createCampaign(_params(token, amount));
    }

    function _leaves(uint256 id, address[] memory accounts, uint256[] memory amounts)
        internal
        pure
        returns (bytes32[] memory leaves)
    {
        leaves = new bytes32[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            leaves[i] = Merkle.leaf(id, accounts[i], amounts[i]);
        }
    }

    function _sum(uint256[] memory amounts) internal pure returns (uint256 s) {
        for (uint256 i; i < amounts.length; ++i) {
            s += amounts[i];
        }
    }

    /// @dev Warps to the snapshot time if needed and posts the root of the given allocation.
    function _postRoot(uint256 id, address[] memory accounts, uint256[] memory amounts)
        internal
        returns (bytes32[] memory leaves)
    {
        leaves = _leaves(id, accounts, amounts);
        uint64 snap = cp.getCampaign(id).snapshotTime;
        if (block.timestamp < snap) vm.warp(snap);
        vm.prank(oracle);
        // forge-lint: disable-next-line(unsafe-typecast)
        cp.postRoot(id, Merkle.root(leaves), uint128(_sum(amounts)), SNAP_HASH);
    }

    function _warpPastDispute(uint256 id) internal {
        vm.warp(uint256(cp.getCampaign(id).rootPostedAt) + cp.DISPUTE_WINDOW());
    }

    function _claimDeadline(uint256 id) internal view returns (uint256) {
        return uint256(cp.getCampaign(id).rootPostedAt) + cp.DISPUTE_WINDOW() + cp.CLAIM_PERIOD();
    }

    function _abc() internal view returns (address[] memory accounts, uint256[] memory amounts) {
        accounts = new address[](3);
        amounts = new uint256[](3);
        accounts[0] = alice;
        accounts[1] = bob;
        accounts[2] = carol;
        amounts[0] = 200e6;
        amounts[1] = 300e6;
        amounts[2] = 100e6;
    }
}
