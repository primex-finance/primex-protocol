// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {ICurvePool} from "../interfaces/routers/ICurvePool.sol";
import {ICurveBotLens} from "./interfaces/ICurveBotLens.sol";

contract CurveBotLens is ICurveBotLens {
    using WadRayMath for uint256;

    function removeAndSetLiquidity(ICurvePool _pool, uint256[3] memory _amounts) external override {
        IERC20 lpToken = IERC20(_pool.token());
        // remove all liquidity of msg.sender
        uint256 lpTokenBalance = lpToken.balanceOf(msg.sender);
        if (lpTokenBalance > 0) {
            uint256 toRemove = lpToken.totalSupply() == lpTokenBalance ? lpTokenBalance - 1 : lpTokenBalance;
            if (toRemove > 0) {
                lpToken.transferFrom(msg.sender, address(this), toRemove);
                lpToken.approve(address(_pool), toRemove);
                uint256[3] memory minAmounts;
                _pool.remove_liquidity(toRemove, minAmounts);
            }
        }

        // increase amounts if some of the balances is higher than requested amount
        ///HACK: can increase amounts and exceed approved or available balance of msg.sender
        uint256 increaseAssets = WadRayMath.WAD;
        for (uint256 i; i < 3; i++) {
            uint256 poolBalance = _pool.balances(i);
            if (poolBalance > _amounts[i]) {
                ///HACK: can overflow if requested amount is too low
                uint256 increaseThisAsset = poolBalance.wdiv(_amounts[i]);
                if (increaseThisAsset > increaseAssets) {
                    increaseAssets = increaseThisAsset;
                }
            }
        }

        for (uint256 i; i < 3; i++) {
            IERC20 asset = IERC20(_pool.coins(i));
            uint256 poolBalance = _pool.balances(i);
            uint256 lensBalance = asset.balanceOf(address(this));
            if (increaseAssets > WadRayMath.WAD) {
                _amounts[i] = _amounts[i].wmul(increaseAssets);
            }

            _amounts[i] = _amounts[i] - poolBalance;
            if (lensBalance < _amounts[i]) {
                asset.transferFrom(msg.sender, address(this), _amounts[i] - lensBalance);
            }
            asset.approve(address(_pool), _amounts[i]);
        }

        _pool.add_liquidity(_amounts, 0);

        // return assets and lp tokens to user
        lpToken.transfer(msg.sender, lpToken.balanceOf(address(this)));
        for (uint256 i; i < 3; i++) {
            IERC20 asset = IERC20(_pool.coins(i));
            asset.transfer(msg.sender, asset.balanceOf(address(this)));
        }
    }
}
