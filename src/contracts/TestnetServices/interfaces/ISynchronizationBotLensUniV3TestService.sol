// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

interface ISynchronizationBotLensUniV3TestService {
    function swapUniswapV3(ISwapRouter _swapRouterUniV3, ISwapRouter.ExactInputSingleParams[] memory params) external;

    function getUserBalances(
        address sender,
        address[] calldata assets
    ) external view returns (uint256 nativeBalance, uint256[] memory assetsBalances, uint256 blockNumber);

    function getArraySqrtPriceX96(
        IUniswapV3Pool[] calldata pools
    ) external view returns (uint160[] memory arraySqrtPriceX96);
}
