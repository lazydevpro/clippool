// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ClipPool} from "../src/ClipPool.sol";

/// @notice Deploys ClipPool and allowlists USDC + EURC for the current Arc chain.
/// Env: DEPLOYER_PRIVATE_KEY (owner + broadcaster), ORACLE_PRIVATE_KEY (only its address is used),
///      GUARDIAN_ADDRESS. Optional (not on mainnet): DISPUTE_WINDOW_SECONDS, MIN_MEASUREMENT_DELAY_SECONDS.
/// Per-chain windows: 5042 → 48h / 1h (fixed), 5042002 → 10min / 5min, 31337 → 10min / 1min.
/// Writes deployments/<chainid>.json {address, deployBlock, oracle, guardian, disputeWindow,
/// minMeasurementDelay} when broadcasting.
contract Deploy is Script {
    address internal constant USDC = 0x3600000000000000000000000000000000000000; // same on 5042 / 5042002
    address internal constant EURC_MAINNET = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    address internal constant EURC_TESTNET = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    error UnsupportedChain(uint256 chainId);
    error MainnetWindowOverride();

    uint256 internal constant MAINNET = 5042;
    uint256 internal constant TESTNET = 5042002;
    uint256 internal constant ANVIL = 31337;

    function tokensFor(uint256 chainId) public pure returns (address usdc, address eurc) {
        if (chainId == MAINNET) return (USDC, EURC_MAINNET);
        if (chainId == TESTNET) return (USDC, EURC_TESTNET);
        if (chainId == ANVIL) return (address(0), address(0)); // local anvil: no allowlist
        revert UnsupportedChain(chainId);
    }

    /// @notice Default (dispute window, min measurement delay) in seconds for a chain.
    function defaultWindowsFor(uint256 chainId) public pure returns (uint64 disputeWindow, uint64 minMeasurementDelay) {
        if (chainId == MAINNET) return (48 hours, 1 hours);
        if (chainId == TESTNET) return (10 minutes, 5 minutes);
        if (chainId == ANVIL) return (10 minutes, 1 minutes);
        revert UnsupportedChain(chainId);
    }

    /// @notice Windows for a chain, honouring DISPUTE_WINDOW_SECONDS / MIN_MEASUREMENT_DELAY_SECONDS overrides.
    ///         Overrides are refused on mainnet, which always uses 48h / 1h.
    function windowsFor(uint256 chainId) public view returns (uint64 disputeWindow, uint64 minMeasurementDelay) {
        (disputeWindow, minMeasurementDelay) = defaultWindowsFor(chainId);
        bool hasWindow = vm.envExists("DISPUTE_WINDOW_SECONDS");
        bool hasDelay = vm.envExists("MIN_MEASUREMENT_DELAY_SECONDS");
        if (chainId == MAINNET) {
            if (hasWindow || hasDelay) revert MainnetWindowOverride();
            return (disputeWindow, minMeasurementDelay);
        }
        // Range is validated by the ClipPool constructor.
        if (hasWindow) disputeWindow = _envU64("DISPUTE_WINDOW_SECONDS");
        if (hasDelay) minMeasurementDelay = _envU64("MIN_MEASUREMENT_DELAY_SECONDS");
    }

    function _envU64(string memory name) internal view returns (uint64) {
        uint256 v = vm.envUint(name);
        require(v <= type(uint64).max, "env value exceeds uint64");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(v);
    }

    function run() external returns (ClipPool cp) {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address oracle = vm.addr(vm.envUint("ORACLE_PRIVATE_KEY"));
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        (address usdc, address eurc) = tokensFor(block.chainid);
        (uint64 disputeWindow, uint64 minMeasurementDelay) = windowsFor(block.chainid);

        uint256 deployBlock = block.number;
        vm.startBroadcast(deployerPk);
        cp = new ClipPool(deployer, oracle, guardian, disputeWindow, minMeasurementDelay);
        if (usdc != address(0)) cp.setTokenAllowed(usdc, true);
        if (eurc != address(0)) cp.setTokenAllowed(eurc, true);
        vm.stopBroadcast();

        console.log("ClipPool", address(cp));
        console.log("chainId", block.chainid, "deployBlock", deployBlock);
        console.log("owner", deployer);
        console.log("oracle", oracle);
        console.log("guardian", guardian);
        console.log("disputeWindow (s)", cp.DISPUTE_WINDOW());
        console.log("minMeasurementDelay (s)", cp.MIN_MEASUREMENT_DELAY());

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            string memory key = "deployment";
            vm.serializeAddress(key, "address", address(cp));
            vm.serializeUint(key, "deployBlock", deployBlock);
            vm.serializeAddress(key, "oracle", oracle);
            vm.serializeAddress(key, "guardian", guardian);
            vm.serializeUint(key, "disputeWindow", disputeWindow);
            string memory json = vm.serializeUint(key, "minMeasurementDelay", minMeasurementDelay);
            string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
            vm.writeJson(json, path);
            console.log("wrote", path);
        } else {
            console.log("dry run: deployments/<chainid>.json not written (use --broadcast)");
        }
    }
}
