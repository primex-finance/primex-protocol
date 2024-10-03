// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {ISwapRouter} from "@cryptoalgebra/solidity-interfaces/contracts/periphery/ISwapRouter.sol";
import {IAlgebraPool} from "@cryptoalgebra/solidity-interfaces/contracts/core/IAlgebraPool.sol";

interface ISynchronizationBotLensQuickswapTestService {
    function swapWithQuickswap(
        ISwapRouter _swapRouterQuickswap,
        ISwapRouter.ExactInputSingleParams[] memory params
    ) external;

    function getUserBalances(
        address sender,
        address[] calldata assets
    ) external view returns (uint256 nativeBalance, uint256[] memory assetsBalances, uint256 blockNumber);

    function getArraySqrtPriceX96(
        IAlgebraPool[] calldata pools
    ) external view returns (uint160[] memory arraySqrtPriceX96);
}
