// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IUniLikeOracle {
    function getExchangeRate(address baseToken, address quoteToken) external returns (uint256);
}
