// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import {ISynchronizationBotLens} from "./interfaces/ISynchronizationBotLens.sol";

contract SynchronizationBotLens is ISynchronizationBotLens {
    function swapAndAddLiquidity(
        IUniswapV2Router02 _uniswapV2Router02,
        address[] calldata _swapPath,
        uint256 _swapAmount,
        address[] calldata _liquidityPath,
        uint256[] calldata _liquidityAmounts
    ) public override {
        if (_swapAmount > 0) {
            if ((_uniswapV2Router02.getAmountsOut(_swapAmount, _swapPath))[1] != 0) {
                IERC20(_swapPath[0]).transferFrom(msg.sender, address(this), _swapAmount);
                IERC20(_swapPath[0]).approve(address(_uniswapV2Router02), _swapAmount);
                _uniswapV2Router02.swapExactTokensForTokens(_swapAmount, 0, _swapPath, msg.sender, type(uint256).max);
            }
        }

        address pair = IUniswapV2Factory(_uniswapV2Router02.factory()).getPair(_liquidityPath[0], _liquidityPath[1]);
        (uint112 _reserve0, uint112 _reserve1, ) = IUniswapV2Pair(pair).getReserves();
        if (_liquidityPath[0] != IUniswapV2Pair(pair).token0()) {
            (_reserve0, _reserve1) = (_reserve1, _reserve0);
        }
        uint256[2] memory optimalAmounts = _addLiquidityOptimalAmounts(_liquidityAmounts, [_reserve0, _reserve1]);
        uint256 lpTokenTotalSupply = IUniswapV2Pair(pair).totalSupply();

        if (
            SignedMath.min(
                int256((optimalAmounts[0] * lpTokenTotalSupply) / _reserve0),
                int256((optimalAmounts[1] * lpTokenTotalSupply) / _reserve1)
            ) == 0
        ) {
            return;
        }

        IERC20(_liquidityPath[0]).transferFrom(msg.sender, address(this), _liquidityAmounts[0]);
        IERC20(_liquidityPath[1]).transferFrom(msg.sender, address(this), _liquidityAmounts[1]);

        IERC20(_liquidityPath[0]).approve(address(_uniswapV2Router02), _liquidityAmounts[0]);
        IERC20(_liquidityPath[1]).approve(address(_uniswapV2Router02), _liquidityAmounts[1]);

        _uniswapV2Router02.addLiquidity(
            _liquidityPath[0],
            _liquidityPath[1],
            _liquidityAmounts[0],
            _liquidityAmounts[1],
            0,
            0,
            msg.sender,
            type(uint256).max
        );
    }

    function swapAndRemoveLiquidity(
        IUniswapV2Router02 _uniswapV2Router02,
        address[] calldata _swapPath,
        uint256 _swapAmount,
        address[] calldata _liquidityPath,
        uint256 _liquidityK
    ) public override {
        if (_swapAmount > 0) {
            if ((_uniswapV2Router02.getAmountsOut(_swapAmount, _swapPath))[1] != 0) {
                IERC20(_swapPath[0]).transferFrom(msg.sender, address(this), _swapAmount);
                IERC20(_swapPath[0]).approve(address(_uniswapV2Router02), _swapAmount);
                _uniswapV2Router02.swapExactTokensForTokens(_swapAmount, 0, _swapPath, msg.sender, type(uint256).max);
            }
        }

        address pair = IUniswapV2Factory(_uniswapV2Router02.factory()).getPair(_liquidityPath[0], _liquidityPath[1]);
        (uint112 _reserve0, uint112 _reserve1, ) = IUniswapV2Pair(pair).getReserves();
        uint256 lpTokenTotalSupply = IUniswapV2Pair(pair).totalSupply();
        uint256 liquidity = (_liquidityK * lpTokenTotalSupply) / (10 ** 18);

        {
            uint256 senderBalance = IERC20(pair).balanceOf(msg.sender);
            if (liquidity > senderBalance) {
                liquidity = senderBalance;
            }
        }

        if (_liquidityPath[0] != IUniswapV2Pair(pair).token0()) {
            (_reserve0, _reserve1) = (_reserve1, _reserve0);
        }

        uint256 amount0 = (liquidity * _reserve0) / lpTokenTotalSupply;
        uint256 amount1 = (liquidity * _reserve1) / lpTokenTotalSupply;

        if (amount0 == 0 || amount1 == 0) {
            return;
        }

        IERC20(pair).transferFrom(msg.sender, address(this), liquidity);
        IERC20(pair).approve(address(_uniswapV2Router02), liquidity);

        _uniswapV2Router02.removeLiquidity(
            _liquidityPath[0],
            _liquidityPath[1],
            liquidity,
            0,
            0,
            msg.sender,
            type(uint256).max
        );
    }

    function _addLiquidityOptimalAmounts(
        uint256[] calldata _amounts,
        uint112[2] memory _reserves
    ) internal virtual returns (uint256[2] memory optimalAmounts) {
        if (_reserves[0] == 0 && _reserves[1] == 0) {
            optimalAmounts = [_amounts[0], _amounts[1]];
        } else {
            uint256 amountBOptimal = (_amounts[0] * _reserves[1]) / _reserves[0];
            if (amountBOptimal <= _amounts[1]) {
                optimalAmounts = [_amounts[0], amountBOptimal];
            } else {
                uint256 amountAOptimal = (_amounts[1] * _reserves[0]) / _reserves[1];
                if (amountAOptimal > _amounts[0]) {
                    optimalAmounts = [uint256(0), uint256(0)];
                }
                optimalAmounts = [amountAOptimal, _amounts[1]];
            }
        }
    }
}
