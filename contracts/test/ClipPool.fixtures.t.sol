// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VmSafe} from "forge-std/Vm.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {console} from "forge-std/console.sol";
import {ClipPool} from "../src/ClipPool.sol";
import {ClipPoolBase} from "./utils/ClipPoolBase.sol";

/// @notice Cross-language check: golden vectors produced by packages/allocation
///         (contracts/test/fixtures/allocation-*.json, format in docs/plans/interfaces.md §4) must post and
///         pay out exactly on the contract.
contract ClipPoolFixturesTest is ClipPoolBase {
    using stdStorage for StdStorage;

    string internal constant DIR = "./test/fixtures";

    function test_fixtures() public {
        VmSafe.DirEntry[] memory entries = vm.readDir(DIR);
        uint256 ran;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].isDir || !_isFixture(entries[i].path)) continue;
            uint256 snap = vm.snapshotState();
            _runFixture(entries[i].path);
            vm.revertToState(snap);
            ++ran;
        }
        if (ran == 0) console.log("SKIP: no allocation-*.json fixtures in", DIR);
        else console.log("fixtures checked:", ran);
    }

    function _runFixture(string memory path) internal {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(path);
        string memory name = vm.parseJsonString(json, ".name");
        console.log("fixture:", name);
        uint256 id = _createFromFixture(json);
        uint256 totalAllocated = vm.parseJsonUint(json, ".expected.totalAllocated");
        uint256 leftover = vm.parseJsonUint(json, ".expected.leftover");
        assertEq(cp.getCampaign(id).pool - totalAllocated, leftover, string.concat(name, ": pool - total != leftover"));

        bytes32 root = _root(json);
        vm.warp(cp.getCampaign(id).snapshotTime);
        uint256 brandBefore = usdc.balanceOf(brand);

        // root == 0 is the "no valid submissions" convention (totalAllocated must be 0; nothing claimable).
        if (root == bytes32(0)) assertEq(totalAllocated, 0, string.concat(name, ": zero root but nonzero total"));
        vm.prank(oracle);
        // forge-lint: disable-next-line(unsafe-typecast)
        cp.postRoot(id, root, uint128(totalAllocated), keccak256(bytes(json)));
        _warpPastDispute(id);

        uint256 sum;
        for (uint256 i;; ++i) {
            string memory k = string.concat(".expected.proofs[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, k)) break;
            sum += _claimEntry(json, k, id, name);
        }
        assertEq(sum, totalAllocated, string.concat(name, ": sum(proofs) != totalAllocated"));
        assertEq(cp.getCampaign(id).claimed, totalAllocated);

        vm.prank(brand);
        cp.refundRemainder(id);
        assertEq(usdc.balanceOf(brand) - brandBefore, leftover, string.concat(name, ": leftover refund"));
        assertEq(usdc.balanceOf(address(cp)), 0, string.concat(name, ": contract not empty"));
    }

    function _createFromFixture(string memory json) internal returns (uint256 id) {
        uint256 fid = vm.parseJsonUint(json, ".campaign.id");
        uint256 poolU = vm.parseJsonUint(json, ".campaign.pool");
        // Make the next campaign id equal the fixture's id (the leaf commits to it).
        stdstore.target(address(cp)).sig("nextCampaignId()").checked_write(fid);
        usdc.mint(brand, poolU);
        // forge-lint: disable-next-line(unsafe-typecast)
        ClipPool.CampaignParams memory p = _params(address(usdc), uint128(poolU));
        p.maxShareBps = uint16(vm.parseJsonUint(json, ".campaign.maxShareBps"));
        p.minViews = uint32(vm.parseJsonUint(json, ".campaign.minViews"));
        vm.prank(brand);
        id = cp.createCampaign(p);
        assertEq(id, fid);
    }

    function _claimEntry(string memory json, string memory k, uint256 id, string memory name)
        internal
        returns (uint256 amount)
    {
        address wallet = vm.parseJsonAddress(json, string.concat(k, ".wallet"));
        amount = vm.parseJsonUint(json, string.concat(k, ".amount"));
        bytes32[] memory proof = _proof(json, string.concat(k, ".proof"));
        uint256 balBefore = usdc.balanceOf(wallet);
        vm.prank(keeper);
        cp.claim(id, wallet, amount, proof);
        assertEq(usdc.balanceOf(wallet) - balBefore, amount, string.concat(name, ": wallet balance"));
        assertTrue(cp.isClaimed(id, wallet));
    }

    function _root(string memory json) internal pure returns (bytes32) {
        return vm.parseJsonBytes32(json, ".expected.root");
    }

    function _proof(string memory json, string memory key) internal view returns (bytes32[] memory proof) {
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(key, "[", vm.toString(n), "]"))) ++n;
        proof = new bytes32[](n);
        for (uint256 j; j < n; ++j) {
            proof[j] = vm.parseJsonBytes32(json, string.concat(key, "[", vm.toString(j), "]"));
        }
    }

    function _isFixture(string memory path) internal pure returns (bool) {
        bytes memory b = bytes(path);
        bytes memory prefix = bytes("allocation-");
        bytes memory suffix = bytes(".json");
        // basename
        uint256 start;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == "/") start = i + 1;
        }
        if (b.length - start < prefix.length + suffix.length) return false;
        for (uint256 i; i < prefix.length; ++i) {
            if (b[start + i] != prefix[i]) return false;
        }
        for (uint256 i; i < suffix.length; ++i) {
            if (b[b.length - suffix.length + i] != suffix[i]) return false;
        }
        return true;
    }
}
