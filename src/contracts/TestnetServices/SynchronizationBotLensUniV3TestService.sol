// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";

import {ISynchronizationBotLensUniV3TestService} from "./interfaces/ISynchronizationBotLensUniV3TestService.sol";

contract SynchronizationBotLensUniV3TestService is ISynchronizationBotLensUniV3TestService {
    function swapUniswapV3(
        ISwapRouter _swapRouterUniV3,
        ISwapRouter.ExactInputSingleParams[] memory params
    ) public override {
        for (uint256 i; i < params.length; i++) {
            if (params[i].amountIn == type(uint256).max) {
                params[i].amountIn = IERC20(params[i].tokenIn).balanceOf(msg.sender);
            }
            TokenTransfersLibrary.doTransferIn(params[i].tokenIn, msg.sender, params[i].amountIn);

            IERC20(params[i].tokenIn).approve(address(_swapRouterUniV3), params[i].amountIn);

            _swapRouterUniV3.exactInputSingle(params[i]);

            TokenTransfersLibrary.doTransferOut(
                params[i].tokenIn,
                params[i].recipient,
                IERC20(params[i].tokenIn).balanceOf(address(this))
            );
        }
    }

    function getUserBalances(
        address sender,
        address[] calldata assets
    ) public view override returns (uint256 nativeBalance, uint256[] memory assetsBalances, uint256 blockNumber) {
        blockNumber = block.number;
        nativeBalance = sender.balance;
        assetsBalances = new uint256[](assets.length);
        for (uint256 i; i < assets.length; i++) {
            assetsBalances[i] = IERC20(assets[i]).balanceOf(sender);
        }
    }

    function getArraySqrtPriceX96(
        IUniswapV3Pool[] calldata pools
    ) public view override returns (uint160[] memory arraySqrtPriceX96) {
        arraySqrtPriceX96 = new uint160[](pools.length);
        for (uint256 i; i < pools.length; i++) {
            (arraySqrtPriceX96[i], , , , , , ) = pools[i].slot0();
        }
    }
}
