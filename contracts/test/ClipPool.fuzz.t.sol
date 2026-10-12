// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ClipPool} from "../src/ClipPool.sol";
import {Merkle} from "./utils/Merkle.sol";
import {ClipPoolBase} from "./utils/ClipPoolBase.sol";

contract ClipPoolFuzzTest is ClipPoolBase {
    /// @dev Random pro-rata allocation (floor division, sum ≤ pool) → tree → every claim succeeds,
    ///      balances match, and the brand's remainder closes the books exactly.
    function testFuzz_allClaimsSucceedAndSumWithinPool(uint256 seed, uint8 nSeed, uint128 poolSeed) public {
        uint256 n = bound(nSeed, 1, 40);
        uint128 pool = uint128(bound(poolSeed, 1, 1e15));
        usdc.mint(brand, pool);
        uint256 id = _create(address(usdc), pool);

        address[] memory accounts = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        uint256[] memory weights = new uint256[](n);
        uint256 totalWeight;
        for (uint256 i; i < n; ++i) {
            accounts[i] = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
            weights[i] = uint256(keccak256(abi.encode(seed, i, "w"))) % 1e9;
            totalWeight += weights[i];
        }
        for (uint256 i; i < n; ++i) {
            amounts[i] = totalWeight == 0 ? 0 : uint256(pool) * weights[i] / totalWeight;
        }

        bytes32[] memory leaves = _postRoot(id, accounts, amounts);
        uint256 total = _sum(amounts);
        assertLe(total, pool);
        _warpPastDispute(id);

        ClipPool.Claim[] memory claims = new ClipPool.Claim[](n);
        for (uint256 i; i < n; ++i) {
            claims[i] = ClipPool.Claim({account: accounts[i], amount: amounts[i], proof: Merkle.proof(leaves, i)});
        }
        vm.prank(keeper);
        assertEq(cp.claimMany(id, claims), n);

        for (uint256 i; i < n; ++i) {
            assertEq(usdc.balanceOf(accounts[i]), amounts[i]);
            assertTrue(cp.isClaimed(id, accounts[i]));
        }
        ClipPool.Campaign memory c = cp.getCampaign(id);
        assertEq(c.claimed, total);
        assertLe(c.claimed, c.pool);

        uint256 before = usdc.balanceOf(brand);
        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(usdc.balanceOf(brand) - before, pool - total);
        assertEq(usdc.balanceOf(address(cp)), 0);
    }

    /// @dev Any amount other than the leaf's is rejected.
    function testFuzz_wrongAmountRejected(uint256 wrong) public {
        uint256 id = _create();
        (address[] memory a, uint256[] memory m) = _abc();
        vm.assume(wrong != m[0]);
        bytes32[] memory leaves = _postRoot(id, a, m);
        _warpPastDispute(id);
        bytes32[] memory p = Merkle.proof(leaves, 0);
        // amounts above the remaining allocation hit ExceedsAllocation first; both are rejections
        vm.expectRevert();
        cp.claim(id, alice, wrong, p);
        assertFalse(cp.isClaimed(id, alice));
    }

    /// @dev Valid params always create; snapshotTime = endTime + measurementDelay.
    function testFuzz_createParams(uint64 start, uint64 len, uint64 delay, uint16 bps, uint128 amount) public {
        start = uint64(bound(start, 0, type(uint64).max / 2));
        len = uint64(bound(len, 1, type(uint64).max / 4));
        delay = uint64(bound(delay, 1 hours, type(uint64).max / 4));
        bps = uint16(bound(bps, 1, 10_000));
        amount = uint128(bound(amount, 1, 1e18));
        usdc.mint(brand, amount);
        ClipPool.CampaignParams memory p = ClipPool.CampaignParams({
            token: address(usdc),
            pool: amount,
            startTime: start,
            endTime: start + len,
            measurementDelay: delay,
            maxShareBps: bps,
            minViews: 0,
            rulesHash: bytes32(0)
        });
        vm.prank(brand);
        uint256 id = cp.createCampaign(p);
        assertEq(cp.getCampaign(id).snapshotTime, uint256(start) + len + delay);
    }
}
