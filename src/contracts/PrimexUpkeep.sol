// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LimitOrderLibrary} from "./libraries/LimitOrderLibrary.sol";
import {PrimexPricingLibrary} from "./libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "./libraries/PositionLibrary.sol";
import "./libraries/Errors.sol";

import {BIG_TIMELOCK_ADMIN} from "./Constants.sol";
import {IPositionManagerV2} from "./PositionManager/IPositionManager.sol";
import {ILimitOrderManager} from "./LimitOrderManager/ILimitOrderManager.sol";
import {IPrimexUpkeep} from "./interfaces/IPrimexUpkeep.sol";
import {IBestDexLens} from "./interfaces/IBestDexLens.sol";
import {IPrimexLens} from "./interfaces/IPrimexLens.sol";
import {ILimitPriceCOM} from "./interfaces/ILimitPriceCOM.sol";
import {ITakeProfitStopLossCCM} from "./interfaces/ITakeProfitStopLossCCM.sol";

contract PrimexUpkeep is IPrimexUpkeep, Initializable {
    uint256 public constant MAX_UINT256 = type(uint256).max;

    address public immutable override registry;
    IPositionManagerV2 public override pm;
    ILimitOrderManager public override lom;
    IPrimexLens public override primexLens;
    IBestDexLens public override bestDexLens;

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    constructor(address _registry) {
        _require(
            IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
    }

    function initialize(
        address _positionManager,
        address _limitOrderManager,
        address _bestDexLens,
        address _primexLens
    ) external override initializer onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165(_bestDexLens).supportsInterface(type(IBestDexLens).interfaceId) &&
                IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId) &&
                IERC165(_primexLens).supportsInterface(type(IPrimexLens).interfaceId) &&
                IERC165(_limitOrderManager).supportsInterface(type(ILimitOrderManager).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        pm = IPositionManagerV2(_positionManager);
        lom = ILimitOrderManager(_limitOrderManager);
        bestDexLens = IBestDexLens(_bestDexLens);
        primexLens = IPrimexLens(_primexLens);
    }

    /**
     * @inheritdoc IPrimexUpkeep
     */
    function performUpkeepOrders(OpenByOrderInfo[] calldata toOpenByOrder, address keeper) external payable override {
        for (uint256 i; i < toOpenByOrder.length; i++) {
            try
                lom.openPositionByOrder{value: toOpenByOrder[i].value}(
                    LimitOrderLibrary.OpenPositionParams({
                        orderId: toOpenByOrder[i].id,
                        conditionIndex: toOpenByOrder[i].conditionIndex,
                        comAdditionalParams: toOpenByOrder[i].comAdditionalParams,
                        firstAssetMegaRoutes: toOpenByOrder[i].firstAssetMegaRoutes,
                        depositInThirdAssetMegaRoutes: toOpenByOrder[i].depositInThirdAssetMegaRoutes,
                        keeper: keeper,
                        firstAssetOracleData: toOpenByOrder[i].firstAssetOracleData,
                        thirdAssetOracleData: toOpenByOrder[i].thirdAssetOracleData,
                        depositSoldAssetOracleData: toOpenByOrder[i].depositSoldAssetOracleData,
                        nativePmxOracleData: toOpenByOrder[i].nativePmxOracleData,
                        positionNativeAssetOracleData: toOpenByOrder[i].positionNativeAssetOracleData,
                        nativePositionAssetOracleData: toOpenByOrder[i].nativePositionAssetOracleData,
                        pmxPositionAssetOracleData: toOpenByOrder[i].pmxPositionAssetOracleData,
                        positionUsdOracleData: toOpenByOrder[i].positionUsdOracleData,
                        nativeSoldAssetOracleData: toOpenByOrder[i].nativeSoldAssetOracleData,
                        pullOracleData: toOpenByOrder[i].pullOracleData,
                        pullOracleTypes: toOpenByOrder[i].pullOracleTypes,
                        borrowedAmount: toOpenByOrder[i].borrowedAmount
                    })
                )
            {} catch Error(string memory revertReason) {
                emit ErrorHandled(toOpenByOrder[i].id, keeper, revertReason);
            } catch Panic(uint revertReason) {
                emit PanicErrorHandled(revertReason);
            } catch (bytes memory revertReason) {
                emit LowLevelErrorHandled(revertReason);
            }
        }
    }

    /**
     * @inheritdoc IPrimexUpkeep
     */
    function performUpkeepOrdersUnsafe(
        OpenByOrderInfo[] calldata toOpenByOrder,
        address keeper
    ) external payable override {
        for (uint256 i; i < toOpenByOrder.length; i++) {
            lom.openPositionByOrder{value: toOpenByOrder[i].value}(
                LimitOrderLibrary.OpenPositionParams({
                    orderId: toOpenByOrder[i].id,
                    conditionIndex: toOpenByOrder[i].conditionIndex,
                    comAdditionalParams: toOpenByOrder[i].comAdditionalParams,
                    firstAssetMegaRoutes: toOpenByOrder[i].firstAssetMegaRoutes,
                    depositInThirdAssetMegaRoutes: toOpenByOrder[i].depositInThirdAssetMegaRoutes,
                    keeper: keeper,
                    firstAssetOracleData: toOpenByOrder[i].firstAssetOracleData,
                    thirdAssetOracleData: toOpenByOrder[i].thirdAssetOracleData,
                    depositSoldAssetOracleData: toOpenByOrder[i].depositSoldAssetOracleData,
                    nativePmxOracleData: toOpenByOrder[i].nativePmxOracleData,
                    positionNativeAssetOracleData: toOpenByOrder[i].positionNativeAssetOracleData,
                    nativePositionAssetOracleData: toOpenByOrder[i].nativePositionAssetOracleData,
                    pmxPositionAssetOracleData: toOpenByOrder[i].pmxPositionAssetOracleData,
                    positionUsdOracleData: toOpenByOrder[i].positionUsdOracleData,
                    nativeSoldAssetOracleData: toOpenByOrder[i].nativeSoldAssetOracleData,
                    pullOracleData: toOpenByOrder[i].pullOracleData,
                    pullOracleTypes: toOpenByOrder[i].pullOracleTypes,
                    borrowedAmount: toOpenByOrder[i].borrowedAmount
                })
            );
        }
    }

    /**
     * @inheritdoc IPrimexUpkeep
     */
    function performUpkeepPositions(
        ClosePositionInfo[] calldata toLiquidate,
        address keeper
    ) external payable override {
        for (uint256 i; i < toLiquidate.length; i++) {
            try
                pm.closePositionByCondition{value: toLiquidate[i].value}(
                    IPositionManagerV2.ClosePositionByConditionParams({
                        id: toLiquidate[i].id,
                        keeper: keeper,
                        megaRoutes: toLiquidate[i].positionAssetMegaRoutes,
                        conditionIndex: toLiquidate[i].conditionIndex,
                        ccmAdditionalParams: toLiquidate[i].ccmAdditionalParams,
                        closeReason: toLiquidate[i].closeReason,
                        positionSoldAssetOracleData: toLiquidate[i].positionSoldAssetOracleData,
                        nativePmxOracleData: toLiquidate[i].nativePmxOracleData,
                        positionNativeAssetOracleData: toLiquidate[i].positionNativeAssetOracleData,
                        pmxSoldAssetOracleData: toLiquidate[i].pmxSoldAssetOracleData,
                        nativeSoldAssetOracleData: toLiquidate[i].nativeSoldAssetOracleData,
                        pullOracleData: toLiquidate[i].pullOracleData,
                        pullOracleTypes: toLiquidate[i].pullOracleTypes
                    })
                )
            {} catch Error(string memory revertReason) {
                emit ErrorHandled(toLiquidate[i].id, keeper, revertReason);
            } catch Panic(uint revertReason) {
                emit PanicErrorHandled(revertReason);
            } catch (bytes memory revertReason) {
                emit LowLevelErrorHandled(revertReason);
            }
        }
    }

    /**
     * @inheritdoc IPrimexUpkeep
     */
    function performUpkeepPositionsUnsafe(
        ClosePositionInfo[] calldata toLiquidate,
        address keeper
    ) external payable override {
        for (uint256 i; i < toLiquidate.length; i++) {
            pm.closePositionByCondition{value: toLiquidate[i].value}(
                IPositionManagerV2.ClosePositionByConditionParams({
                    id: toLiquidate[i].id,
                    keeper: keeper,
                    megaRoutes: toLiquidate[i].positionAssetMegaRoutes,
                    conditionIndex: toLiquidate[i].conditionIndex,
                    ccmAdditionalParams: toLiquidate[i].ccmAdditionalParams,
                    closeReason: toLiquidate[i].closeReason,
                    positionSoldAssetOracleData: toLiquidate[i].positionSoldAssetOracleData,
                    nativePmxOracleData: toLiquidate[i].nativePmxOracleData,
                    positionNativeAssetOracleData: toLiquidate[i].positionNativeAssetOracleData,
                    pmxSoldAssetOracleData: toLiquidate[i].pmxSoldAssetOracleData,
                    nativeSoldAssetOracleData: toLiquidate[i].nativeSoldAssetOracleData,
                    pullOracleData: toLiquidate[i].pullOracleData,
                    pullOracleTypes: toLiquidate[i].pullOracleTypes
                })
            );
        }
    }
}
