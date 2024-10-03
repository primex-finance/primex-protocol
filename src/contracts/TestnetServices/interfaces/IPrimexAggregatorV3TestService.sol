// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IPrimexAggregatorV3TestService {
    function setAnswer(int256 answer) external;

    function setDecimals(uint256 newDecimals) external;
}
