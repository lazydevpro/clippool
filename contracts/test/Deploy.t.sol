// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// Per-chain dispute window / min measurement delay selection in script/Deploy.s.sol.
contract DeployWindowsTest is Test {
    Deploy internal d;

    function setUp() public {
        d = new Deploy();
    }

    function test_defaultWindows() public view {
        (uint64 w, uint64 m) = d.defaultWindowsFor(5042);
        assertEq(w, 48 hours);
        assertEq(m, 1 hours);
        (w, m) = d.defaultWindowsFor(5042002);
        assertEq(w, 10 minutes);
        assertEq(m, 5 minutes);
        (w, m) = d.defaultWindowsFor(31337);
        assertEq(w, 10 minutes);
        assertEq(m, 1 minutes);
    }

    function test_defaultWindows_revertsOnUnknownChain() public {
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 1));
        d.defaultWindowsFor(1);
    }

    /// One test so the process-wide env changes cannot race other tests in this suite.
    function test_envOverrides() public {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.setEnv("DISPUTE_WINDOW_SECONDS", "900");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.setEnv("MIN_MEASUREMENT_DELAY_SECONDS", "120");
        (uint64 w, uint64 m) = d.windowsFor(5042002);
        assertEq(w, 900);
        assertEq(m, 120);
        (w, m) = d.windowsFor(31337);
        assertEq(w, 900);
        assertEq(m, 120);
        // mainnet refuses any override
        vm.expectRevert(Deploy.MainnetWindowOverride.selector);
        d.windowsFor(5042);
    }
}
