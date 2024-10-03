// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNSStorage.sol";

interface ILimitPriceCOM {
    struct CanBeFilledParams {
        uint256 limitPrice;
    }

    struct AdditionalParams {
        PrimexPricingLibrary.MegaRoute[] firstAssetMegaRoutes;
        PrimexPricingLibrary.MegaRoute[] depositInThirdAssetMegaRoutes;
        bytes depositBorrowedAssetOracleData;
        bytes borrowedNativeAssetOracleData;
        bytes nativePositionAssetOracleData;
    }

    struct CanBeFilledVars {
        CanBeFilledParams params;
        AdditionalParams additionalParams;
        address borrowedAsset;
        uint256 amountIn;
        uint256 amountOut;
        uint256 amountToTransfer;
        address payable dexAdapter;
        bool isThirdAsset;
        uint256 borrowedAssetMultiplier;
        uint256 exchangeRate;
        uint256 depositInPositionAsset;
        uint256 borrowedAmountInPositionAsset;
        IPrimexDNSStorageV3.TradingOrderType tradingOrderType;
    }

    /**
     * @notice Retrieves the limit price from the provided `_params` input.
     * @dev To use this function correctly, you need to encode a CanBeFilledParams struct into the _params parameter.
     * The CanBeFilledParams struct has field limitPrice.
     * @param _params The encoded parameters containing the limit price information.
     * @return The limit price extracted from the `_params`.
     */
    //TODO Consider removing this function from the protocol as it is currently unused.
    function getLimitPrice(bytes calldata _params) external view returns (uint256);

    /**
     * @notice  Initializes the LimitPriceCOM contract.
     * @dev This function should only be called once during the initial setup of the contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _priceOracle The address of the PriceOracle contract.
     * @param _pm The address of the PositionManager contract.
     * @param _keeperRewardDistributor The address of the KeeperRewardDistributor contract.
     */
    function initialize(
        address _primexDNS,
        address _priceOracle,
        address _pm,
        address _keeperRewardDistributor
    ) external;
}
