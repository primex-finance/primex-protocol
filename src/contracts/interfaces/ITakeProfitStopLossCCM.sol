// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";

interface ITakeProfitStopLossCCM {
    struct CanBeClosedParams {
        uint256 takeProfitPrice;
        uint256 stopLossPrice;
    }

    /**
     * @notice Checks if the take profit has been reached based on the given parameters.
     * @dev Used in closeBatchPositions() function.
     * @param _params The encoded parameters.
     * @param exchangeRate The exchange rate in WAD format.
     * @return A boolean indicating whether the take profit has been reached.
     */
    function isTakeProfitReached(bytes calldata _params, uint256 exchangeRate) external view returns (bool);

    /**
     * @notice Checks if the stop loss price has been reached for a given position.
     * @param _position The position details.
     * @param _stopLossPrice The stop loss price in WAD format to compare against.
     * @return True if the stop loss price is reached, false otherwise.
     */
    function isStopLossReached(
        PositionLibrary.Position calldata _position,
        uint256 _stopLossPrice,
        bytes calldata _positionSoldAssetOracleData
    ) external returns (bool);

    /**
     * @notice Checks if the stop loss price has been reached on the given parameters.
     * @dev The takeProfitPrice and stopLossPrice values can be obtained from the encoded data via CanBeClosedParams struct.
     * @param _params The encoded closing condition parameters containing stop loss price.
     * @param oracleExchangeRate The current exchange rate from the oracle in WAD format.
     * @return True if the stop loss price is reached, false otherwise.
     */
    function isStopLossReached(bytes calldata _params, uint256 oracleExchangeRate) external view returns (bool);

    /**
     * @notice Retrieves the take profit and stop loss prices from the given parameters.
     * @param _params The encoded parameters for closing a position.
     * @return takeProfitPrice The take profit price.
     * @return stopLossPrice The stop loss price.
     */
    function getTakeProfitStopLossPrices(bytes calldata _params) external view returns (uint256, uint256);

    /**
     * @notice Initializes the TakeProfitStopLossCCM contract.
     * @dev This function should only be called once during the initial setup of the contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _priceOracle The address of the PriceOracle contract.
     */
    function initialize(address _primexDNS, address _priceOracle) external;
}
