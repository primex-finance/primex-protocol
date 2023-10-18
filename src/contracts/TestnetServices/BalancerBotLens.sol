// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./../libraries/Errors.sol";

import {IBalancer} from "../interfaces/IBalancer.sol";
import {IAsset} from "../interfaces/IAsset.sol";
import {IBalancerBotLens} from "./interfaces/IBalancerBotLens.sol";

contract BalancerBotLens is IBalancerBotLens {
    function removeAndSetLiquidity(
        IBalancer _vault,
        PoolUpdateData[] calldata _pools,
        IERC20[] calldata _tokensToReturn
    ) external override {
        for (uint256 i; i < _pools.length; i++) {
            (address poolAddress, ) = _vault.getPool(_pools[i].poolId);
            IERC20(poolAddress).transferFrom(msg.sender, address(this), IERC20(poolAddress).balanceOf(msg.sender));
            IERC20(poolAddress).approve(address(_vault), type(uint256).max);

            (IAsset[] memory tokens, uint256[] memory balances, ) = _vault.getPoolTokens(_pools[i].poolId);
            _require(balances.length == _pools[i].amounts.length, Errors.WRONG_BALANCES.selector);

            IBalancer.JoinPoolRequest memory joinData;
            joinData.assets = tokens;
            joinData.maxAmountsIn = new uint256[](balances.length);

            IBalancer.ExitPoolRequest memory exitData;
            exitData.assets = tokens;
            exitData.minAmountsOut = new uint256[](balances.length);

            for (uint256 j; j < joinData.assets.length; j++) {
                // avoid stack too deep error
                address vaultAddress = address(_vault);

                IERC20 tokenERC20 = IERC20(address(joinData.assets[j]));
                uint256 senderBalance = tokenERC20.balanceOf(msg.sender);
                if (senderBalance > 0) tokenERC20.transferFrom(msg.sender, address(this), senderBalance);
                if (tokenERC20.allowance(address(this), vaultAddress) < senderBalance)
                    tokenERC20.approve(vaultAddress, type(uint256).max);

                if (_pools[i].amounts[j] > balances[j]) {
                    joinData.maxAmountsIn[j] = _pools[i].amounts[j] - balances[j];
                    exitData.minAmountsOut[j] = 0;
                } else {
                    joinData.maxAmountsIn[j] = 0;
                    exitData.minAmountsOut[j] = balances[j] - _pools[i].amounts[j];
                }
            }

            // EXACT_TOKENS_IN_FOR_BPT_OUT=1
            joinData.userData = abi.encode(1, joinData.maxAmountsIn, 0);
            _vault.joinPool(_pools[i].poolId, address(this), address(this), joinData);

            // BPT_IN_FOR_EXACT_TOKENS_OUT=2
            exitData.userData = abi.encode(2, exitData.minAmountsOut, type(uint256).max);
            _vault.exitPool(_pools[i].poolId, address(this), payable(address(this)), exitData);

            IERC20(poolAddress).transfer(msg.sender, IERC20(poolAddress).balanceOf(address(this)));
        }

        for (uint256 i; i < _tokensToReturn.length; i++) {
            uint256 balance = _tokensToReturn[i].balanceOf(address(this));
            if (balance > 0) _tokensToReturn[i].transfer(msg.sender, balance);
        }
    }
}
