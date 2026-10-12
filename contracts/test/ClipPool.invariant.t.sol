// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ClipPool} from "../src/ClipPool.sol";
import {BlocklistToken} from "./mocks/BlocklistToken.sol";
import {Merkle} from "./utils/Merkle.sol";

/// @dev Drives ClipPool through random sequences of create / postRoot / cancel / claim / claimMany / refunds /
///      time warps. One recipient is blocklisted so claimMany's isolation path is exercised.
contract ClipPoolHandler is Test {
    ClipPool public cp;
    BlocklistToken public token;
    address public oracle;
    address public guardian;
    address public blocked = address(0xB10C);
    address[3] public brands = [address(0xA1), address(0xA2), address(0xA3)];

    uint256[] public ids;
    mapping(uint256 => address[]) internal accounts;
    mapping(uint256 => uint256[]) internal amounts;
    mapping(uint256 => bytes32[]) internal leaves;

    uint256 public totalPaidOut; // ghost: all tokens that left the contract
    uint256 public rootsPosted;
    uint256 public batchesPaid; // claimMany calls that paid at least one item

    constructor(ClipPool cp_, BlocklistToken token_, address oracle_, address guardian_) {
        cp = cp_;
        token = token_;
        oracle = oracle_;
        guardian = guardian_;
        token.setBlocked(blocked, true);
        for (uint256 i; i < 3; ++i) {
            token.mint(brands[i], type(uint128).max);
            vm.prank(brands[i]);
            token.approve(address(cp), type(uint256).max);
        }
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function _pick(uint256 seed) internal view returns (uint256 id, bool ok) {
        if (ids.length == 0) return (0, false);
        return (ids[seed % ids.length], true);
    }

    function create(uint256 brandSeed, uint128 poolSeed, uint64 delaySeed) external {
        uint128 pool = uint128(bound(poolSeed, 1, 1e15));
        uint64 delay = uint64(bound(delaySeed, 1 hours, 10 days));
        ClipPool.CampaignParams memory p = ClipPool.CampaignParams({
            token: address(token),
            pool: pool,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            measurementDelay: delay,
            maxShareBps: 10_000,
            minViews: 0,
            rulesHash: bytes32(0)
        });
        vm.prank(brands[brandSeed % 3]);
        ids.push(cp.createCampaign(p));
    }

    function postRoot(uint256 idSeed, uint256 seed, uint8 nSeed, bool overstate) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok) return;
        ClipPool.Campaign memory c = cp.getCampaign(id);
        if (c.root != bytes32(0) || c.remainderRefunded) return;
        if (block.timestamp < c.snapshotTime) vm.warp(c.snapshotTime);
        if (block.timestamp > uint256(c.snapshotTime) + cp.ROOT_DEADLINE()) return;

        uint256 n = bound(nSeed, 1, 6);
        delete accounts[id];
        delete amounts[id];
        uint256 remaining = c.pool;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            address a =
                i == 0 && seed % 2 == 0 ? blocked : address(uint160(uint256(keccak256(abi.encode(id, seed, i)))));
            uint256 amt = remaining == 0 ? 0 : uint256(keccak256(abi.encode(seed, i))) % (remaining / 2 + 1);
            remaining -= amt;
            total += amt;
            accounts[id].push(a);
            amounts[id].push(amt);
        }
        bytes32[] memory l = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            l[i] = Merkle.leaf(id, accounts[id][i], amounts[id][i]);
        }
        leaves[id] = l;
        // optionally understate totalAllocated to exercise the ExceedsAllocation guard
        uint256 posted = overstate || total == 0 ? total : total - 1;
        vm.prank(oracle);
        // forge-lint: disable-next-line(unsafe-typecast)
        cp.postRoot(id, Merkle.root(l), uint128(posted), keccak256(abi.encode(seed)));
        ++rootsPosted;
    }

    function cancelRoot(uint256 idSeed) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok) return;
        vm.prank(guardian);
        try cp.cancelRoot(id) {} catch {}
    }

    function claim(uint256 idSeed, uint256 leafSeed) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok || leaves[id].length == 0) return;
        uint256 i = leafSeed % leaves[id].length;
        uint256 before = token.balanceOf(address(cp));
        try cp.claim(id, accounts[id][i], amounts[id][i], Merkle.proof(leaves[id], i)) {} catch {}
        totalPaidOut += before - token.balanceOf(address(cp));
    }

    function claimMany(uint256 idSeed) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok || leaves[id].length == 0) return;
        uint256 n = leaves[id].length;
        ClipPool.Claim[] memory cs = new ClipPool.Claim[](n);
        for (uint256 i; i < n; ++i) {
            cs[i] =
                ClipPool.Claim({account: accounts[id][i], amount: amounts[id][i], proof: Merkle.proof(leaves[id], i)});
        }
        uint256 before = token.balanceOf(address(cp));
        try cp.claimMany(id, cs) returns (uint256 ok_) {
            if (ok_ > 0) ++batchesPaid;
        } catch {}
        totalPaidOut += before - token.balanceOf(address(cp));
    }

    function refundRemainder(uint256 idSeed) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok) return;
        uint256 before = token.balanceOf(address(cp));
        vm.prank(cp.getCampaign(id).brand);
        try cp.refundRemainder(id) {} catch {}
        totalPaidOut += before - token.balanceOf(address(cp));
    }

    function sweepUnclaimed(uint256 idSeed) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok) return;
        uint256 before = token.balanceOf(address(cp));
        vm.prank(cp.getCampaign(id).brand);
        try cp.sweepUnclaimed(id) {} catch {}
        totalPaidOut += before - token.balanceOf(address(cp));
    }

    function refundNoRoot(uint256 idSeed) external {
        (uint256 id, bool ok) = _pick(idSeed);
        if (!ok) return;
        uint256 before = token.balanceOf(address(cp));
        vm.prank(cp.getCampaign(id).brand);
        try cp.refundNoRoot(id) {} catch {}
        totalPaidOut += before - token.balanceOf(address(cp));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 30 days));
    }

    function toggleBlock(bool b) external {
        token.setBlocked(blocked, b);
    }
}

contract ClipPoolInvariantTest is Test {
    ClipPool internal cp;
    BlocklistToken internal token;
    ClipPoolHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        address oracle = makeAddr("oracle");
        address guardian = makeAddr("guardian");
        cp = new ClipPool(address(this), oracle, guardian, 48 hours, 1 hours);
        token = new BlocklistToken();
        cp.setTokenAllowed(address(token), true);
        handler = new ClipPoolHandler(cp, token, oracle, guardian);
        targetContract(address(handler));
    }

    function afterInvariant() public view {
        console.log("campaigns", handler.idCount(), "roots", handler.rootsPosted());
        console.log("paid batches", handler.batchesPaid(), "paid out", handler.totalPaidOut());
    }

    /// @dev Outstanding liability of a campaign: pool − claimed − refunded remainder − swept unclaimed.
    function _outstanding(ClipPool.Campaign memory c) internal pure returns (uint256 o) {
        o = uint256(c.pool) - c.claimed;
        if (c.remainderRefunded) o -= uint256(c.pool) - c.totalAllocated; // refundNoRoot: totalAllocated == 0
        if (c.unclaimedSwept) o -= uint256(c.totalAllocated) - c.claimed;
    }

    function invariant_balanceCoversLiabilities() public view {
        uint256 liabilities;
        uint256 pools;
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            ClipPool.Campaign memory c = cp.getCampaign(handler.ids(i));
            assertLe(c.claimed, c.totalAllocated, "claimed > totalAllocated");
            assertLe(c.totalAllocated, c.pool, "totalAllocated > pool");
            liabilities += _outstanding(c);
            pools += c.pool;
        }
        uint256 bal = token.balanceOf(address(cp));
        assertGe(bal, liabilities, "balance < liabilities");
        // exact accounting: nothing leaks besides recorded payouts/refunds
        assertEq(bal, pools - handler.totalPaidOut(), "balance != pools - paid out");
        assertEq(bal, liabilities, "balance != liabilities");
    }
}
