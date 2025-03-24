// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

interface IUniswapV2LPOracle {
    function getQuoteInUsd(
        address lpToken,
        uint256 amount,
        bytes calldata token0UsdOracleData,
        bytes calldata token1UsdOracleData
    ) external returns (uint256);

    function getLPExchangeRate(
        IUniswapV2Pair pair,
        bytes calldata token0UsdOracleData,
        bytes calldata token1UsdOracleData
    ) external returns (uint256);
}
