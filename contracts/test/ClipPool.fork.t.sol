// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ClipPool} from "../src/ClipPool.sol";
import {Merkle} from "./utils/Merkle.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// Fork tests against real Arc state (USDC system token, EURC FiatToken).
/// Run: arc-forge test --match-contract Fork --fork-url https://rpc.testnet.arc.io
/// (CLI-level fork is required so Arc Foundry enables Arc precompiles such as the USDC blocklist.)
/// Skipped unless the test runs on an Arc chain id. Local simulation only — nothing is broadcast.
contract ClipPoolArcForkTest is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    ClipPool cp;
    address owner = makeAddr("owner");
    address oracle = makeAddr("oracle");
    address guardian = makeAddr("guardian");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address brand;
    uint256 brandPk;
    bool forkEnabled;

    function setUp() public {
        if (block.chainid != 5042 && block.chainid != 5042002) return;
        forkEnabled = true;
        (brand, brandPk) = makeAddrAndKey("fork-brand");
        // Same per-chain windows the deploy script uses (testnet: 10 min dispute, 5 min min delay).
        (uint64 window, uint64 minDelay) = new Deploy().defaultWindowsFor(block.chainid);
        cp = new ClipPool(owner, oracle, guardian, window, minDelay);
        vm.startPrank(owner);
        cp.setTokenAllowed(USDC, true);
        address eurc = _eurc();
        if (eurc != address(0)) cp.setTokenAllowed(eurc, true);
        vm.stopPrank();
    }

    function _eurc() internal view returns (address) {
        if (block.chainid == 5042) return 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
        if (block.chainid == 5042002) return 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
        return address(0);
    }

    function _params(address token, uint128 pool) internal view returns (ClipPool.CampaignParams memory p) {
        p = ClipPool.CampaignParams({
            token: token,
            pool: pool,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 hours),
            // forge-lint: disable-next-line(unsafe-typecast)
            measurementDelay: uint64(cp.MIN_MEASUREMENT_DELAY()),
            maxShareBps: 10_000,
            minViews: 0,
            rulesHash: keccak256("fork rules")
        });
    }

    /// Native USDC (18 dp) and the ERC-20 interface (6 dp) are one balance on Arc.
    function test_fork_usdcDualInterface() public {
        if (!forkEnabled) vm.skip(true);
        vm.deal(brand, 250 ether); // 250 native USDC
        assertEq(IERC20(USDC).balanceOf(brand), 250e6, "ERC-20 view = native / 1e12");
    }

    /// Full lifecycle with real USDC: permit-funded create → root → claimMany → remainder refund.
    function test_fork_fullCampaign_realUsdcPermit() public {
        if (!forkEnabled) vm.skip(true);
        uint128 pool = 100e6;
        vm.deal(brand, 1_000 ether);

        ClipPool.CampaignParams memory p = _params(USDC, pool);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, brand, address(cp), uint256(pool), IERC20Permit(USDC).nonces(brand), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC20Permit(USDC).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(brandPk, digest);

        vm.prank(brand);
        uint256 id = cp.createCampaignWithPermit(p, deadline, v, r, s);
        assertEq(IERC20(USDC).balanceOf(address(cp)), pool, "pool escrowed");

        // alice 60, bob 30 → 90 allocated, 10 leftover
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = Merkle.leaf(id, alice, 60e6);
        leaves[1] = Merkle.leaf(id, bob, 30e6);
        bytes32 root = Merkle.root(leaves);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(oracle);
        cp.postRoot(id, root, 90e6, keccak256("snapshot"));

        vm.warp(block.timestamp + cp.DISPUTE_WINDOW());
        ClipPool.Claim[] memory claims = new ClipPool.Claim[](2);
        claims[0] = ClipPool.Claim(alice, 60e6, Merkle.proof(leaves, 0));
        claims[1] = ClipPool.Claim(bob, 30e6, Merkle.proof(leaves, 1));
        assertEq(cp.claimMany(id, claims), 2);

        assertEq(IERC20(USDC).balanceOf(alice), 60e6);
        assertEq(alice.balance, 60 ether, "payout visible as native USDC too");
        assertEq(IERC20(USDC).balanceOf(bob), 30e6);

        uint256 before = IERC20(USDC).balanceOf(brand);
        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(IERC20(USDC).balanceOf(brand) - before, 10e6, "leftover refunded");
        assertEq(IERC20(USDC).balanceOf(address(cp)), 0);
    }

    /// EURC (FiatToken v2) campaign with approve + createCampaign.
    function test_fork_eurcCampaign() public {
        if (!forkEnabled) vm.skip(true);
        address eurc = _eurc();
        uint128 pool = 50e6;
        deal(eurc, brand, pool);
        vm.deal(brand, 1 ether); // gas is irrelevant in tests but keep the account native-funded

        vm.startPrank(brand);
        IERC20(eurc).approve(address(cp), pool);
        uint256 id = cp.createCampaign(_params(eurc, pool));
        vm.stopPrank();

        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = Merkle.leaf(id, alice, pool);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(oracle);
        cp.postRoot(id, Merkle.root(leaves), pool, keccak256("snapshot"));
        vm.warp(block.timestamp + cp.DISPUTE_WINDOW());
        cp.claim(id, alice, pool, Merkle.proof(leaves, 0));
        assertEq(IERC20(eurc).balanceOf(alice), pool);
    }
}
