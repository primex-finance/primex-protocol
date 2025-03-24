// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

/* solhint-disable */

interface IStorkVerify {
    function verifySignature(
        address oracle_pubkey,
        string memory asset_pair_id,
        uint256 timestamp,
        uint256 price,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) external pure returns (bool);
}
