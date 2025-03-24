// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/** @notice  A modified version of PriceFeed contract
    Origin: https://github.com/decentralizedlabs/uniswap-v3-price-feed
    Contract adapted for use with the Algebra DEX Engine
*/

import "./IAlgebraPriceFeed.sol";
import {OracleLibrary} from "@uniswap/v3-periphery-0.8/contracts/libraries/OracleLibrary.sol";
import {IAlgebraPool} from "@cryptoalgebra/solidity-interfaces/contracts/core/IAlgebraPool.sol";
import {FullMath} from "@uniswap/v3-core-0.8/contracts/libraries/FullMath.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MEDIUM_TIMELOCK_ADMIN} from "../Constants.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IAlgebraFactory} from "@cryptoalgebra/solidity-interfaces/contracts/core/IAlgebraFactory.sol";
import "../libraries/Errors.sol";

// solhint-disable
/**
 * @author jacopo.eth <jacopo@slice.so>
 *
 * @notice Price feed based on Algebra V3 TWAP oracles.
 */
contract AlgebraPriceFeed is IAlgebraPriceFeed, ERC165 {
    using WadRayMath for uint256;
    /// =================================
    /// ============ Events =============
    /// =================================

    /// AlgebraV3Factory contract address
    IAlgebraFactory public immutable algebraV3Factory;

    /// =================================
    /// ============ Storage ============
    /// =================================

    /// Mapping from currency to the pool address
    mapping(address => mapping(address => address)) public pools;

    IAccessControl public override registry;

    /// TWAP interval in seconds
    uint32 public override twapInterval;

    /// =================================
    /// ========== Constructor ==========
    /// =================================

    constructor(IAlgebraFactory algebraV3Factory_, uint32 twapInterval_, address registry_) {
        _require(
            ERC165(registry_).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        algebraV3Factory = algebraV3Factory_;
        twapInterval = twapInterval_;
        registry = IAccessControl(registry_);
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
     * @return pool Address of the Algebra Pool
     */
    function getPool(address tokenA, address tokenB) public view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        return pools[token0][token1];
    }

    /**
     * @notice Sets the pool via algebra factory
     * @param tokenA Address of one of the ERC20 token contract in the pool
     * @param tokenB Address of the other ERC20 token contract in the pool
     */

    function setPool(address tokenA, address tokenB) public returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        address pool = algebraV3Factory.poolByPair(token0, token1);
        if (pool != address(0)) {
            pools[token0][token1] = pool;
        }
        return pool;
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
            (getQuote(baseAmount, baseToken, quoteToken, twapInterval) * multiplierQuote).wdiv(
                baseAmount * multiplierBase
            );
    }

    /**
     * @notice Get the time-weighted quote of `quoteToken` received in exchange for a `baseAmount`
     * of `baseToken`, from the pool with highest liquidity, based on a `secondsTwapInterval` twap interval.
     * @param baseAmount Amount of baseToken to be converted
     * @param baseToken Address of an ERC20 token contract used as the baseAmount denomination
     * @param quoteToken Address of an ERC20 token contract used as the quoteAmount denomination
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted quote
     * @return quoteAmount Equivalent amount of ERC20 token for baseAmount
     *
     * Note: If a pool does not exist or a valid quote is not returned execution will revert
     */
    function getQuote(
        uint128 baseAmount,
        address baseToken,
        address quoteToken,
        uint32 secondsTwapInterval
    ) public returns (uint256 quoteAmount) {
        address pool = getPool(baseToken, quoteToken);
        if (pool == address(0)) {
            pool = setPool(baseToken, quoteToken);
        }
        if (pool != address(0)) {
            // Get spot price
            if (secondsTwapInterval == 0) {
                // Get sqrtPriceX96 from slot0
                (uint160 sqrtPriceX96, , , , , , ) = IAlgebraPool(pool).globalState();
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
     * @notice Set a new twap interval
     * @param _twapInterval new TWAP interval in seconds
     */
    function setTwapInterval(uint32 _twapInterval) external onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        twapInterval = _twapInterval;
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IAlgebraPriceFeed).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Same as `consult` in {OracleLibrary} but saves gas by not calculating `harmonicMeanLiquidity`.
     * @param pool Address of the pool that we want to observe
     * @param secondsTwapInterval Number of seconds in the past from which to calculate the time-weighted means
     */
    function _getArithmeticMeanTick(
        address pool,
        uint32 secondsTwapInterval
    ) private view returns (int24 arithmeticMeanTick) {
        uint32[] memory secondsTwapIntervals = new uint32[](2);
        secondsTwapIntervals[0] = secondsTwapInterval;
        secondsTwapIntervals[1] = 0;
        try IAlgebraPool(pool).getTimepoints(secondsTwapIntervals) returns (
            int56[] memory tickCumulatives,
            uint160[] memory,
            uint112[] memory,
            uint256[] memory
        ) {
            int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];

            arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(secondsTwapInterval)));
            // Always round to negative infinity
            if (tickCumulativesDelta < 0 && (tickCumulativesDelta % int56(uint56(secondsTwapInterval)) != 0))
                arithmeticMeanTick--;
        } catch {
            _revert(Errors.POOL_CALL_FAILED.selector);
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
