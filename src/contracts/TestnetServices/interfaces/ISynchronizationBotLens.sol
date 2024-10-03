// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

interface ISynchronizationBotLens {
    function swapAndAddLiquidity(
        IUniswapV2Router02 _uniswapV2Router02,
        address[] calldata _swapPath,
        uint256 _swapAmount,
        address[] calldata _liquidityPath,
        uint256[] calldata _liquidityAmounts
    ) external;

    function swapAndRemoveLiquidity(
        IUniswapV2Router02 _uniswapV2Router02,
        address[] calldata _swapPath,
        uint256 _swapAmount,
        address[] calldata _liquidityPath,
        uint256 _liquidityK
    ) external;
}
