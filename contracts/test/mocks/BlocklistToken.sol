// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20Permit} from "./MockERC20Permit.sol";

/// @notice Mimics USDC's blocklist: transfers to a blocked address revert (or, in `returnFalse` mode,
///         return false without moving funds).
contract BlocklistToken is MockERC20Permit {
    error Blocklisted(address account);

    mapping(address => bool) public blocked;
    bool public returnFalse;

    constructor() MockERC20Permit("Blocklist USD", "BUSD") {}

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function setReturnFalse(bool v) external {
        returnFalse = v;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (blocked[to] && returnFalse) return false;
        return super.transfer(to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
