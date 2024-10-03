// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";

import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {ILimitOrderManager} from "../LimitOrderManager/ILimitOrderManager.sol";
import {IPrimexLens} from "./IPrimexLens.sol";
import {IBestDexLens} from "./IBestDexLens.sol";

interface IPrimexUpkeep {
    enum LiquidationSource {
        NONE,
        POSITION,
        ORDER
    }

    struct OpenByOrderInfo {
        uint256 id;
        uint256 conditionIndex;
        bytes comAdditionalParams;
        PrimexPricingLibrary.MegaRoute[] firstAssetMegaRoutes;
        PrimexPricingLibrary.MegaRoute[] depositInThirdAssetMegaRoutes;
        bytes firstAssetOracleData;
        bytes thirdAssetOracleData;
        bytes depositSoldAssetOracleData;
        bytes nativePmxOracleData;
        bytes positionNativeAssetOracleData;
        bytes nativePositionAssetOracleData;
        bytes pmxPositionAssetOracleData;
        bytes positionUsdOracleData;
        bytes nativeSoldAssetOracleData;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
        uint256 value;
        uint256 borrowedAmount;
    }

    struct ClosePositionInfo {
        uint256 id;
        uint256 conditionIndex;
        bytes ccmAdditionalParams;
        PrimexPricingLibrary.MegaRoute[] positionAssetMegaRoutes;
        PositionLibrary.CloseReason closeReason;
        bytes positionSoldAssetOracleData;
        bytes nativePmxOracleData;
        bytes positionNativeAssetOracleData;
        bytes pmxSoldAssetOracleData;
        bytes nativeSoldAssetOracleData;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
        uint256 value;
    }

    struct MegaRoutes {
        PrimexPricingLibrary.MegaRoute[] firstAssetMegaRoutes;
        PrimexPricingLibrary.MegaRoute[] depositInThirdAssetMegaRoutes;
    }

    struct Closable {
        bool isRiskyOrDelisted;
        bool canBeClosed;
        PositionLibrary.CloseReason closeReason;
    }

    struct CheckUpkeepParams {
        IBestDexLens.DexWithAncillaryData[] dexes;
        uint256 cursor;
        uint256 count;
        uint256 outputSize;
    }

    event ErrorHandled(uint256 indexed positionId, address indexed keeper, string reason);

    event PanicErrorHandled(uint256 indexed panicErrorId);

    event LowLevelErrorHandled(bytes revertReason);

    function pm() external returns (IPositionManagerV2);

    function lom() external returns (ILimitOrderManager);

    function primexLens() external returns (IPrimexLens);

    function registry() external returns (address);

    function bestDexLens() external returns (IBestDexLens);

    /**
     * @notice Liquidates positions or closes them by condition.
     * @param toLiquidate Array of ClosePositionInfo containing information about positions to be liquidated.
     * @param keeper The address of the keeper performing the upkeep.
     */
    function performUpkeepPositions(ClosePositionInfo[] calldata toLiquidate, address keeper) external payable;

    /**
     * @notice Equivalent to performUpkeepPositions() but lacking the try/catch block internally.
     * @param toLiquidate Array of ClosePositionInfo containing information about positions to be liquidated.
     * @param keeper The address of the keeper performing the upkeep.
     */
    function performUpkeepPositionsUnsafe(ClosePositionInfo[] calldata toLiquidate, address keeper) external payable;

    /**
     * @notice Executes limit orders based on the provided OpenByOrderInfo array.
     * @param toOpenByOrder The array of OpenByOrderInfo structs containing the necessary information to open positions.
     * @param keeper The address of the keeper performing the upkeep.
     */
    function performUpkeepOrders(OpenByOrderInfo[] calldata toOpenByOrder, address keeper) external payable;

    /**
     * @notice Equivalent to performUpkeepOrders() but lacking the try/catch block internally.
     * @param toOpenByOrder The array of OpenByOrderInfo structs containing the necessary information to open positions.
     * @param keeper The address of the keeper performing the upkeep.
     */
    function performUpkeepOrdersUnsafe(OpenByOrderInfo[] calldata toOpenByOrder, address keeper) external payable;

    /**
     * @notice  Initializes the PrimexUpkeep contract.
     * @dev This function should only be called once during the initial setup of the contract.
     * @param _positionManager The address of the PositionManager contract.
     * @param _limitOrderManager The address of the LimitOrderManager contract.
     * @param _bestDexLens The address of the BestDexLens contract.
     * @param _primexLens The address of the PrimexLens contract.
     */

    function initialize(
        address _positionManager,
        address _limitOrderManager,
        address _bestDexLens,
        address _primexLens
    ) external;
}
