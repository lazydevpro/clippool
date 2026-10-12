// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Minimal Merkle tree builder compatible with OZ `MerkleProof` (sorted-pair keccak).
///         Odd nodes are promoted to the next level unchanged.
library Merkle {
    /// @dev OZ StandardMerkleTree leaf for `(uint256 id, address account, uint256 amount)`.
    function leaf(uint256 id, address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id, account, amount))));
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "empty");
        bytes32[] memory level = leaves;
        while (level.length > 1) level = _next(level);
        return level[0];
    }

    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory out) {
        bytes32[] memory tmp = new bytes32[](256);
        uint256 len;
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < level.length) tmp[len++] = level[sibling];
            level = _next(level);
            index >>= 1;
        }
        out = new bytes32[](len);
        for (uint256 i; i < len; ++i) {
            out[i] = tmp[i];
        }
    }

    function _next(bytes32[] memory level) private pure returns (bytes32[] memory up) {
        uint256 n = level.length;
        up = new bytes32[]((n + 1) / 2);
        for (uint256 i; i < n; i += 2) {
            up[i / 2] = i + 1 < n ? Hashes.commutativeKeccak256(level[i], level[i + 1]) : level[i];
        }
    }
}
