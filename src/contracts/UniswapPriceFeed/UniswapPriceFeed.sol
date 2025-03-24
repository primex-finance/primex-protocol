// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/** @notice  A modified version of PriceFeed contract
    Origin: https://github.com/decentralizedlabs/uniswap-v3-price-feed
    The getExchangeRate function was added, which converts quote amount to exchange rate and updates the pool as needed
    Fixed TWAP calculations in the getQuoteAndUpdatePool function
    Added several set functions
*/

import "./IUniswapPriceFeed.sol";
import {OracleLibrary} from "@uniswap/v3-periphery-0.8/contracts/libraries/OracleLibrary.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core-0.8/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core-0.8/contracts/interfaces/IUniswapV3Pool.sol";
import {PoolAddress} from "../libraries/utils/PoolAddress.sol";
import {FullMath} from "@uniswap/v3-core-0.8/contracts/libraries/FullMath.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SMALL_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN} from "../Constants.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../libraries/Errors.sol";

// solhint-disable
/**
 * @author jacopo.eth <jacopo@slice.so>
 *
 * @notice Price feed based on Uniswap V3 TWAP oracles.
 */
contract UniswapPriceFeed is IUniswapPriceFeed, ERC165 {
    using WadRayMath for uint256;
    /// =================================
    /// ============ Events =============
    /// =================================

    /// Emitted when a pool is updated
    event PoolUpdated(PoolData pool);

    /// =================================
    /// ======= Immutable Storage =======
    /// =================================

    /// Current observation cardinality value under which a cardinality increase is triggered when updating pools
    uint16 public constant MAX_CARDINALITY = 256;
    /// TWAP interval used when updating pools
    uint32 public constant UPDATE_INTERVAL = 30 minutes;
    /// UPDATE_INTERVAL multiplied by 2**160
    uint192 private constant UPDATE_INTERVAL_X160 = uint192(UPDATE_INTERVAL) << 160;
    /// UPDATE_INTERVAL formatted as uint32[]
    uint32[] private UPDATE_SECONDS_AGO = [UPDATE_INTERVAL, 0];
    /// UniswapV3Pool fee tiers
    uint24[] public fees = [10000, 3000, 500, 100];
    /// Mapping of active fee tiers
    mapping(uint24 => bool) public activeFees;
    /// UniswapV3Factory contract address
    address public immutable uniswapV3Factory;

    /// =================================
    /// ============ Storage ============
    /// =================================

    /// Mapping from currency to PoolData
    mapping(address => mapping(address => PoolData)) public pools;

    IAccessControl public override registry;

    /// TWAP interval in seconds
    uint32 public override twapInterval;

    // time in seconds showing at what interval the existing pool will be updated
    uint256 public override poolUpdateInterval;

    /// =================================
    /// ========== Constructor ==========
    /// =================================

    constructor(address uniswapV3Factory_, uint32 twapInterval_, uint256 poolUpdateInterval_, address registry_) {
        _require(
            ERC165(registry_).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        uniswapV3Factory = uniswapV3Factory_;
        twapInterval = twapInterval_;
        poolUpdateInterval = poolUpdateInterval_;
        registry = IAccessControl(registry_);
        // Activate fee tiers
        for (uint256 i; i < fees.length; ) {
            activeFees[fees[i]] = true;
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /// =================================
    /// =========== Functions ===========
    /// =================================

    /**
     * @notice Retrieves stored pool given tokenA and tokenB regardless of order.
     * @param tokenA Address of one of the ERC20 token contract in the pool
     * @param tokenB Address of the other ERC20 token contract in the pool
     * @return pool address, fee, last edit timestamp and last recorded cardinality.
     */
    function getPool(address tokenA, address tokenB) public view returns (PoolData memory pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        pool = pools[token0][token1];
    }

    /**
     * @notice Converts quote amount to exchange rate and updates the pool as needed
     * @param baseToken Address of an ERC20 token contract used as the baseAmount denomination
     * @param quoteToken Address of an ERC20 token contract used as the quoteAmount denomination
     */

    function getExchangeRate(address baseToken, address quoteToken) external override returns (uint256) {
        uint128 baseAmount = uint128(10 ** IERC20Metadata(baseToken).decimals());
        uint256 multiplierBase = 10 ** (18 - IERC20Metadata(baseToken).decimals());
        uint256 multiplierQuote = 10 ** (18 - IERC20Metadata(quoteToken).decimals());
        return
            (getQuoteAndUpdatePool(baseAmount, baseToken, quoteToken, twapInterval, poolUpdateInterval, 0) *
                multiplierQuote).wdiv(baseAmount * multiplierBase);
    }

    /**
     * @notice Get the time-weighted quote of `quoteToken` received in exchange for a `baseAmount`
     * of `baseToken`, from the pool with highest liquidity, based on a `secondsTwapInterval` twap interval.
     * @param baseAmount Amount of baseToken to be converted
     * @param baseToken Address of an ERC20 token contract used as the baseAmount denomination
     * @param quoteToken Address of an ERC20 token contract used as the quoteAmount denomination
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted quote
     * @return quoteAmount Equivalent amount of ERC20 token for baseAmount
     */
    function getQuote(
        uint128 baseAmount,
        address baseToken,
        address quoteToken,
        uint32 secondsTwapInterval
    ) public view returns (uint256 quoteAmount) {
        address pool = getPool(baseToken, quoteToken).poolAddress;

        if (pool != address(0)) {
            // Get spot price
            if (secondsTwapInterval == 0) {
                // Get sqrtPriceX96 from slot0
                (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool).slot0();
                quoteAmount = _getQuoteAtSqrtPriceX96(sqrtPriceX96, baseAmount, baseToken, quoteToken);
            }
            // Get TWAP price
            else {
                int24 arithmeticMeanTick = _getArithmeticMeanTick(pool, secondsTwapInterval);
                quoteAmount = OracleLibrary.getQuoteAtTick(arithmeticMeanTick, baseAmount, baseToken, quoteToken);
            }
        }
    }

    /**
     * @notice Retrieves stored pool given tokenA and tokenB regardless of order, and updates pool if necessary.
     * @param tokenA Address of one of the ERC20 token contract in the pool
     * @param tokenB Address of the other ERC20 token contract in the pool
     * @param secondsUpdateInterval Seconds after which a pool is considered stale and an update is triggered
     * @param cardinalityNextIncrease The amount of cardinality to increase when updating a pool, if
     * current value < MAX_CARDINALITY.
     * @return pool address, fee, last edit timestamp and last recorded cardinality.
     * @return tickCumulatives Cumulative tick values as of 30 minutes from the current block timestamp
     * @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
     *
     * Note: Set `secondsUpdateInterval` to 0 to always trigger an update, or to block.timestamp to only update if a pool
     * has not been stored yet.
     * Note: Set `cardinalityNextIncrease` to 0 to disable increasing cardinality when updating pool.
     */
    function getUpdatedPool(
        address tokenA,
        address tokenB,
        uint256 secondsUpdateInterval,
        uint8 cardinalityNextIncrease
    ) public returns (PoolData memory pool, int56[] memory tickCumulatives, uint160 sqrtPriceX96) {
        // Shortcircuit update when `secondsUpdateInterval` == 0
        if (secondsUpdateInterval == 0)
            return _updatePool(tokenA, tokenB, secondsUpdateInterval, cardinalityNextIncrease);

        pool = getPool(tokenA, tokenB);

        // Update pool if no pool is stored or `secondsUpdateInterval` has passed since `lastUpdatedTimestamp`
        if (pool.poolAddress == address(0) || pool.lastUpdatedTimestamp + secondsUpdateInterval <= block.timestamp) {
            return _updatePool(tokenA, tokenB, secondsUpdateInterval, cardinalityNextIncrease);
        }
    }

    /**
     * @notice Get the time-weighted quote of `quoteToken`, and updates the pool when necessary.
     * @param baseAmount Amount of baseToken to be converted
     * @param baseToken Address of an ERC20 token contract used as the baseAmount denomination
     * @param quoteToken Address of an ERC20 token contract used as the quoteAmount denomination
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted quote
     * @param secondsUpdateInterval Seconds after which a pool is considered stale and an update is triggered
     * @param cardinalityNextIncrease The increase in cardinality to trigger in a pool if current value < MAX_CARDINALITY
     * @return quoteAmount Equivalent amount of ERC20 token for baseAmount
     * Note: Set `secondsUpdateInterval` to 0 to always trigger an update, or to block.timestamp to only update if a pool
     * has not been stored yet.
     * Note: Set `cardinalityNextIncrease` to 0 to disable increasing cardinality when updating pool.
     */
    function getQuoteAndUpdatePool(
        uint128 baseAmount,
        address baseToken,
        address quoteToken,
        uint32 secondsTwapInterval,
        uint256 secondsUpdateInterval,
        uint8 cardinalityNextIncrease
    ) public returns (uint256 quoteAmount) {
        (PoolData memory pool, , uint160 sqrtPriceX96) = getUpdatedPool(
            baseToken,
            quoteToken,
            secondsUpdateInterval,
            cardinalityNextIncrease
        );

        // If pool exists
        if (pool.poolAddress != address(0)) {
            // Get spot price
            if (secondsTwapInterval == 0) {
                // If sqrtPriceX96 was not returned from `getUpdatedPool`
                if (sqrtPriceX96 == 0) {
                    // Get sqrtPriceX96 from slot0
                    (sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool.poolAddress).slot0();
                }
                quoteAmount = _getQuoteAtSqrtPriceX96(sqrtPriceX96, baseAmount, baseToken, quoteToken);
            }
            // Get TWAP price
            else {
                quoteAmount = OracleLibrary.getQuoteAtTick(
                    _getArithmeticMeanTick(pool.poolAddress, secondsTwapInterval),
                    baseAmount,
                    baseToken,
                    quoteToken
                );
            }
        }
    }

    /**
     * @notice Updates stored pool with the one having the highest TWAL in the last 30 minutes. See `_updatePool`.
     * @param tokenA Address of one of the ERC20 token contract in the pool
     * @param tokenB Address of the other ERC20 token contract in the pool
     * @param cardinalityNextIncrease The amount of observation cardinality to increase when updating a pool if
     * current value < MAX_CARDINALITY
     * @return highestLiquidityPool Pool with the highest harmonic mean liquidity
     * @return tickCumulatives Cumulative tick values as of 30 minutes from the current block timestamp
     * @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
     */
    function updatePool(
        address tokenA,
        address tokenB,
        uint8 cardinalityNextIncrease
    ) public returns (PoolData memory highestLiquidityPool, int56[] memory tickCumulatives, uint160 sqrtPriceX96) {
        return _updatePool(tokenA, tokenB, 0, cardinalityNextIncrease);
    }

    /**
     * @notice Updates stored pool with the one having the highest TWAL in the last 30 minutes.
     * @param tokenA Address of one of the ERC20 token contract in the pool
     * @param tokenB Address of the other ERC20 token contract in the pool
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted quote
     * @param cardinalityNextIncrease The amount of observation cardinality to increase when updating a pool if
     * current value < MAX_CARDINALITY
     * @return highestLiquidityPool Pool with the highest harmonic mean liquidity
     * @return tickCumulatives Cumulative tick values as of 30 minutes from the current block timestamp
     * @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
     */
    function _updatePool(
        address tokenA,
        address tokenB,
        uint256 secondsTwapInterval,
        uint8 cardinalityNextIncrease
    ) internal returns (PoolData memory highestLiquidityPool, int56[] memory tickCumulatives, uint160 sqrtPriceX96) {
        // Order token addresses
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        // Get highest liquidity pool
        (highestLiquidityPool, tickCumulatives, sqrtPriceX96) = _getHighestLiquidityPool(
            token0,
            token1,
            secondsTwapInterval,
            cardinalityNextIncrease
        );

        /// Update pool in storage with `highestLiquidityPool`
        /// @dev New value should be stored even if highestPool = currentPool to update `lastUpdatedTimestamp`.
        pools[token0][token1] = highestLiquidityPool;
        emit PoolUpdated(highestLiquidityPool);
    }

    /**
     * @notice Add a fee tier to `fees` if supported on Uniswap.
     * @param fee tier to add
     */
    function addFee(uint24 fee) public {
        if (IUniswapV3Factory(uniswapV3Factory).feeAmountTickSpacing(fee) != 0 && !activeFees[fee]) {
            activeFees[fee] = true;
            fees.push(fee);
        }
    }

    /**
     * @notice Set a new twap interval
     * @param _twapInterval new TWAP interval in seconds
     */
    function setTwapInterval(uint32 _twapInterval) external onlyRole(SMALL_TIMELOCK_ADMIN) {
        twapInterval = _twapInterval;
    }

    /**
     * @notice Set a new twap interval
     * @param _poolUpdateInterval new poolUpdateInterval in seconds
     */
    function setPoolUpdateInterval(uint256 _poolUpdateInterval) external onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        poolUpdateInterval = _poolUpdateInterval;
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IUniswapPriceFeed).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Gets the pool with the highest harmonic liquidity.
     * @param token0 Address of the first ERC20 token contract in the pool
     * @param token1 Address of the second ERC20 token contract in the pool
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted quote
     * @param cardinalityNextIncrease The amount of observation cardinality to increase when updating a pool if
     * current value < MAX_CARDINALITY
     * @return highestLiquidityPool Pool with the highest harmonic mean liquidity
     * @return highestTickCumulatives Cumulative tick values of the pool with the highest liquidity
     * as of 30 minutes from the current block timestamp
     * @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
     */
    function _getHighestLiquidityPool(
        address token0,
        address token1,
        uint256 secondsTwapInterval,
        uint8 cardinalityNextIncrease
    )
        private
        returns (PoolData memory highestLiquidityPool, int56[] memory highestTickCumulatives, uint160 sqrtPriceX96)
    {
        // Add reference for highest liquidity value
        uint256 highestLiquidity;

        // Add reference for values used in loop
        address poolAddress;
        uint256 harmonicMeanLiquidity;
        int56[] memory tickCumulatives;

        for (uint256 i; i < fees.length; ) {
            // Compute pool address
            poolAddress = PoolAddress.computeAddress(uniswapV3Factory, PoolAddress.PoolKey(token0, token1, fees[i]));
            // If pool has been deployed
            if (poolAddress.code.length != 0) {
                // Get 30-min harmonic mean liquidity
                (harmonicMeanLiquidity, tickCumulatives) = _getHarmonicMeanLiquidity(poolAddress);
                // If liquidity is higher than the previously stored one
                if (harmonicMeanLiquidity > highestLiquidity) {
                    // Update reference values except pool cardinality
                    highestLiquidity = harmonicMeanLiquidity;
                    highestLiquidityPool = PoolData(poolAddress, fees[i], uint48(block.timestamp), 0);
                    highestTickCumulatives = tickCumulatives;
                }
            }

            unchecked {
                ++i;
            }
        }

        // If there is a pool to update
        if (highestLiquidityPool.poolAddress != address(0)) {
            if (cardinalityNextIncrease != 0 || secondsTwapInterval == 0) {
                // Update observation cardinality of `highestLiquidityPool`
                (sqrtPriceX96, , , , highestLiquidityPool.lastUpdatedCardinalityNext, , ) = IUniswapV3Pool(
                    highestLiquidityPool.poolAddress
                ).slot0();

                // If a cardinality increase is wanted and current cardinalityNext < MAX_CARDINALITY
                if (cardinalityNextIncrease != 0) {
                    if (highestLiquidityPool.lastUpdatedCardinalityNext < MAX_CARDINALITY) {
                        // Increase cardinality and update value in reference pool
                        // Cannot overflow uint16 as MAX_CARDINALITY + type(uint8).max < uint(16).max
                        unchecked {
                            highestLiquidityPool.lastUpdatedCardinalityNext += cardinalityNextIncrease;
                            IUniswapV3Pool(highestLiquidityPool.poolAddress).increaseObservationCardinalityNext(
                                highestLiquidityPool.lastUpdatedCardinalityNext
                            );
                        }
                    }
                }
            }
        }
    }

    /**
     * @notice Same as `consult` in {OracleLibrary} but saves gas by not calculating `harmonicMeanLiquidity`.
     * @param pool Address of the pool that we want to observe
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted means
     * @return arithmeticMeanTick The arithmetic mean tick from (block.timestamp - secondsTwapInterval) to block.timestamp
     */
    function _getArithmeticMeanTick(
        address pool,
        uint32 secondsTwapInterval
    ) private view returns (int24 arithmeticMeanTick) {
        uint32[] memory secondsTwapIntervals = new uint32[](2);
        secondsTwapIntervals[0] = secondsTwapInterval;
        secondsTwapIntervals[1] = 0;

        // Call uniswapV3Pool.observe
        (bool success, bytes memory data) = pool.staticcall(abi.encodeWithSelector(0x883bdbfd, secondsTwapIntervals));

        // If observe hasn't reverted
        if (success) {
            // Decode `tickCumulatives` from returned data
            (int56[] memory tickCumulatives, ) = abi.decode(data, (int56[], uint160[]));

            int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];

            arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(secondsTwapInterval)));
            // Always round to negative infinity
            if (tickCumulativesDelta < 0 && (tickCumulativesDelta % int56(uint56(secondsTwapInterval)) != 0))
                arithmeticMeanTick--;
        } else {
            _revert(Errors.POOL_CALL_FAILED.selector);
        }
    }

    /**
     * @notice Same as `consult` in {OracleLibrary} but saves gas by not calculating `arithmeticMeanTick` and
     * defaulting to twap interval to `UPDATE_SECONDS_AGO`.
     * @param pool Address of the pool that we want to observe
     * @return harmonicMeanLiquidity The harmonic mean liquidity from (block.timestamp - secondsTwapInterval) to block.timestamp
     * @return tickCumulatives Cumulative tick values as of 30 minutes from the current block timestamp
     *
     * @dev Silently handles errors in `uniswapV3Pool.observe` to prevent reverts.
     */
    function _getHarmonicMeanLiquidity(
        address pool
    ) private view returns (uint128 harmonicMeanLiquidity, int56[] memory tickCumulatives) {
        // Call uniswapV3Pool.observe
        (bool success, bytes memory data) = pool.staticcall(abi.encodeWithSelector(0x883bdbfd, UPDATE_SECONDS_AGO));

        // If observe hasn't reverted
        if (success) {
            uint160[] memory secondsPerLiquidityCumulativeX128s;
            // Decode `tickCumulatives` and `secondsPerLiquidityCumulativeX128s` from returned data
            (tickCumulatives, secondsPerLiquidityCumulativeX128s) = abi.decode(data, (int56[], uint160[]));

            uint160 secondsPerLiquidityCumulativesDelta = secondsPerLiquidityCumulativeX128s[1] -
                secondsPerLiquidityCumulativeX128s[0];

            harmonicMeanLiquidity = uint128(
                UPDATE_INTERVAL_X160 / (uint192(secondsPerLiquidityCumulativesDelta) << 32)
            );
        }
    }

    /// @notice Reduced `getQuoteAtTick` logic which directly uses sqrtPriceX96
    /// @param sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
    /// @param baseAmount Amount of token to be converted
    /// @param baseToken Address of an ERC20 token contract used as the baseAmount denomination
    /// @param quoteToken Address of an ERC20 token contract used as the quoteAmount denomination
    /// @return quoteAmount Amount of quoteToken received for baseAmount of baseToken
    function _getQuoteAtSqrtPriceX96(
        uint160 sqrtPriceX96,
        uint128 baseAmount,
        address baseToken,
        address quoteToken
    ) private pure returns (uint256 quoteAmount) {
        // Calculate quoteAmount with better precision if it doesn't overflow when multiplied by itself
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            quoteAmount = baseToken < quoteToken
                ? FullMath.mulDiv(ratioX192, baseAmount, 1 << 192)
                : FullMath.mulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? FullMath.mulDiv(ratioX128, baseAmount, 1 << 128)
                : FullMath.mulDiv(1 << 128, baseAmount, ratioX128);
        }
    }
}
