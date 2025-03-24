// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {USD} from "../Constants.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IUniswapV2LPOracle} from "./IUniswapV2LPOracle.sol";
import "../libraries/Errors.sol";

///////////////////////////////////////////////////////
//                                                   //
//    Methodology for Calculating LP Token Price     //
//                                                   //
///////////////////////////////////////////////////////

// A naïve approach to calculate the price of LP tokens, assuming the protocol
// fee is zero, is to compute the price of the assets locked in its liquidity
// pool, and divide it by the total amount of LP tokens issued:
//
// (p_0 * r_0 + p_1 * r_1) / LP_supply              (1)
//
// where r_0 and r_1 are the reserves of the two tokens held by the pool, and
// p_0 and p_1 are their respective prices in some reference unit of account.
//
// However, the price of LP tokens (i.e. pool shares) needs to be evaluated
// based on reserve values r_0 and r_1 that cannot be arbitraged, i.e. values
// that give the two halves of the pool equal economic value:
//
// r_0 * p_0 = r_1 * p_1                            (2)
//
// Furthermore, two-asset constant product pools, neglecting fees, satisfy
// (before and after trades):
//
// r_0 * r_1 = k                                    (3)
//
// Using (2) and (3) we can compute R_i, the arbitrage-free reserve values, in a
// manner that depends only on k (which can be derived from the current reserve
// balances, even if they are far from equilibrium) and market prices p_i
// obtained from a trusted source:
//
// R_0 = sqrt(k * p_1 / p_0)                        (4)
//   and
// R_1 = sqrt(k * p_0 / p_1)                        (5)
//
// The value of an LP token is then, replacing (4) and (5) in (1):
//
// (p_0 * R_0 + p_1 * R_1) / LP_supply
//     = 2 * sqrt(k * p_0 * p_1) / LP_supply        (6)
//
// k can be re-expressed in terms of the current pool reserves r_0 and r_1:
//
// 2 * sqrt((r_0 * p_0) * (r_1 * p_1)) / LP_supply  (7)
//
// The structure of (7) is well-suited for use in fixed-point EVM calculations, as the
// terms (r_0 * p_0) and (r_1 * p_1), being the values of the reserves in the reference unit,
// should have reasonably-bounded sizes. This reduces the likelihood of overflow due to
// tokens with very low prices but large total supplies.

contract UniswapV2LPOracle is IUniswapV2LPOracle {
    using WadRayMath for uint256;

    IPriceOracleV2 public priceOracle;

    constructor(address _priceOracle) {
        priceOracle = IPriceOracleV2(_priceOracle);
    }

    function getQuoteInUsd(
        address lpToken,
        uint256 amount,
        bytes calldata token0UsdOracleData,
        bytes calldata token1UsdOracleData
    ) external override returns (uint256) {
        // return in wad 'cause the lp tokens always have 18 dec
        return amount.wmul(getLPExchangeRate(IUniswapV2Pair(lpToken), token0UsdOracleData, token1UsdOracleData));
    }

    function getLPExchangeRate(
        IUniswapV2Pair pair,
        bytes calldata token0UsdOracleData,
        bytes calldata token1UsdOracleData
    ) public override returns (uint256) {
        // Sync up reserves of uniswap liquidity pool
        pair.sync();

        // Get reserves of uniswap liquidity pool
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        address token0 = pair.token0();
        address token1 = pair.token1();
        uint256 decimals0 = IERC20Metadata(token0).decimals();
        uint256 decimals1 = IERC20Metadata(token1).decimals();
        _require(r0 > 0 && r1 > 0, Errors.INVALID_RESERVES.selector);
        // All Oracle prices are priced with 18 decimals against USD

        // getExchangeRate
        uint256 price0 = priceOracle.getExchangeRate(token0, USD, token0UsdOracleData); //WAD
        uint256 price1 = priceOracle.getExchangeRate(token1, USD, token1UsdOracleData); //WAD
        _require(price0 > 0 && price1 > 0, Errors.INVALID_PRICES.selector);

        // Get LP token supply
        uint256 supply = pair.totalSupply();

        uint256 value0 = (price0 * uint256(r0)) / 10 ** decimals0; // WAD
        uint256 value1 = (price1 * uint256(r1)) / 10 ** decimals1; // WAD
        // 2 * sqrt((r_0 * p_0) * (r_1 * p_1)) / LP_supply
        uint256 price = (2 * WadRayMath.WAD * sqrt(value0 * value1)) / supply; // Will revert if supply == 0
        return price; // WAD
    }

    // FROM https://github.com/abdk-consulting/abdk-libraries-solidity/blob/16d7e1dd8628dfa2f88d5dadab731df7ada70bdd/ABDKMath64x64.sol#L687
    // implementation from https://github.com/Uniswap/uniswap-lib/commit/99f3f28770640ba1bb1ff460ac7c5292fb8291a0
    // original implementation: https://github.com/abdk-consulting/abdk-libraries-solidity/blob/master/ABDKMath64x64.sol#L687
    function sqrt(uint x) internal pure returns (uint) {
        if (x == 0) return 0;
        uint xx = x;
        uint r = 1;

        if (xx >= 0x100000000000000000000000000000000) {
            xx >>= 128;
            r <<= 64;
        }

        if (xx >= 0x10000000000000000) {
            xx >>= 64;
            r <<= 32;
        }
        if (xx >= 0x100000000) {
            xx >>= 32;
            r <<= 16;
        }
        if (xx >= 0x10000) {
            xx >>= 16;
            r <<= 8;
        }
        if (xx >= 0x100) {
            xx >>= 8;
            r <<= 4;
        }
        if (xx >= 0x10) {
            xx >>= 4;
            r <<= 2;
        }
        if (xx >= 0x8) {
            r <<= 1;
        }

        r = (r + x / r) >> 1;
        r = (r + x / r) >> 1;
        r = (r + x / r) >> 1;
        r = (r + x / r) >> 1;
        r = (r + x / r) >> 1;
        r = (r + x / r) >> 1;
        r = (r + x / r) >> 1; // Seven iterations should be enough
        uint r1 = x / r;
        return (r < r1 ? r : r1);
    }
}
