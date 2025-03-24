// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import {ICurveAddressProvider} from "../interfaces/curve/ICurveAddressProvider.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title ICurveOracle
 * @notice Interface for the CurveOracle contract which provides price feed data for assets on Curve Finance.
 */
interface ICurveBaseOracle {
    /**
     * @notice Event emitted when a new LP token is registered within its respective implementation.
     * @param token Address of the LP token being registered
     */
    event RegisterLpToken(address token);

    /**
     * @notice Fetches relevant information about a Curve liquidity pool.
     * @param crvLp The address of the Curve liquidity pool token (LP token).
     * @return pool Address of the pool contract.
     * @return coins A list of underlying tokens in the Curve liquidity pool.
     * @return virtualPrice The current virtual price of the LP token for the given Curve liquidity pool.
     */
    function getPoolInfo(address crvLp) external returns (address pool, address[] memory coins, uint256 virtualPrice);

    /// @notice Returns the Curve Address Provider.
    function getAddressProvider() external view returns (ICurveAddressProvider);

    /**
     * @dev Gets a Registry contract address.
     */
    function primexRegistry() external view returns (IAccessControl);

    /**
     * @notice Retrieves the address of PriceOracle contract.
     */
    function primexPriceOracle() external view returns (IPriceOracleV2);

    /**
     * @notice Fetches the price of the given token in USD with 18 decimals precision.
     * @param token Address of the LP token for which the price is requested.
     * @param tokensUsdOracleData An array of oracle data to use for price calculations
     * @return The USD price of the given token, multiplied by 10**18.
     */
    function getPrice(address token, bytes[] calldata tokensUsdOracleData) external returns (uint256);

    /**
     * @notice Initializes the contract
     * @param _addressProvider Address of the curve address provider
     * @param _primexPriceOracle The base oracle instance.
     * @param _primexRegistry Address of the owner of the contract.
     */
    function initialize(
        ICurveAddressProvider _addressProvider,
        IPriceOracleV2 _primexPriceOracle,
        IAccessControl _primexRegistry
    ) external;
}
