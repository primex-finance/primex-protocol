// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
/** @notice This contract (originally IPriceFeed) was taken from (https://github.com/decentralizedlabs/uniswap-v3-price-feed)

*/

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IUniLikeOracle} from "../interfaces/IUniLikeOracle.sol";

interface IUniswapPriceFeed is IUniLikeOracle {
    struct PoolData {
        address poolAddress;
        uint24 fee;
        uint48 lastUpdatedTimestamp;
        uint16 lastUpdatedCardinalityNext;
    }

    function uniswapV3Factory() external view returns (address uniswapV3Factory);

    function activeFees(uint24 index) external view returns (bool);

    function fees(uint256 index) external view returns (uint24 fee);

    function pools(
        address token0,
        address token1
    )
        external
        view
        returns (address poolAddress, uint24 fee, uint48 lastUpdatedTimestamp, uint16 lastUpdatedCardinality);

    function getPool(address tokenA, address tokenB) external view returns (PoolData memory pool);

    function getQuote(
        uint128 baseAmount,
        address baseToken,
        address quoteToken,
        uint32 secondsTwapInterval
    ) external view returns (uint256 quoteAmount);

    function getUpdatedPool(
        address tokenA,
        address tokenB,
        uint256 secondsUpdateInterval,
        uint8 cardinalityNextIncrease
    ) external returns (PoolData memory pool, int56[] memory tickCumulatives, uint160 sqrtPriceX96);

    function getQuoteAndUpdatePool(
        uint128 baseAmount,
        address baseToken,
        address quoteToken,
        uint32 secondsTwapInterval,
        uint256 secondsUpdateInterval,
        uint8 cardinalityNextIncrease
    ) external returns (uint256 quoteAmount);

    function updatePool(
        address tokenA,
        address tokenB,
        uint8 cardinalityNextIncrease
    ) external returns (PoolData memory highestLiquidityPool, int56[] memory tickCumulatives, uint160 sqrtPriceX96);

    function addFee(uint24 fee) external;

    function registry() external view returns (IAccessControl);

    function twapInterval() external view returns (uint32);

    function poolUpdateInterval() external view returns (uint256);
}
