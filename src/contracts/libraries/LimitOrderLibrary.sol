// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {WadRayMath} from "./utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "./PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "./TokenTransfersLibrary.sol";

import {NATIVE_CURRENCY} from "../Constants.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNSStorage.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IConditionalOpeningManager} from "../interfaces/IConditionalOpeningManager.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {ISwapManager} from "../SwapManager/ISwapManager.sol";

import "./Errors.sol";

library LimitOrderLibrary {
    using WadRayMath for uint256;

    enum CloseReason {
        FilledMargin,
        FilledSpot,
        FilledSwap,
        Cancelled
    }

    struct Condition {
        uint256 managerType;
        bytes params;
    }

    /**
     * @dev Creates a limit order and locks the deposit asset in the traderBalanceVault
     * @param bucket The bucket, from which the loan will be taken
     * @param positionAsset The address of output token for exchange
     * @param depositAsset The address of the deposit token
     * @param depositAmount The amount of deposit trader funds for deal
     * @param feeToken An asset in which the fee will be paid. At this point it could be the pmx, the epmx or a positionAsset
     * @param trader The trader, who has created the order
     * @param deadline Unix timestamp after which the order will not be filled
     * @param id The unique id of the order
     * @param leverage leverage for trading
     * @param shouldOpenPosition The flag to indicate whether position should be opened
     * @param createdAt The timeStamp when the order was created
     * @param updatedConditionsAt The timestamp when the open condition was updated
     */
    struct LimitOrder {
        IBucketV3 bucket;
        address positionAsset;
        address depositAsset;
        uint256 depositAmount;
        address feeToken;
        uint256 protocolFee;
        address trader;
        uint256 deadline;
        uint256 id;
        uint256 leverage;
        bool shouldOpenPosition;
        uint256 createdAt;
        uint256 updatedConditionsAt;
        // The byte-encoded params, can be used for future updates
        bytes extraParams;
    }

    /**
     * @dev Structure for the сreateLimitOrder with parameters necessary to create limit order
     * @param bucket The bucket, from which the loan will be taken
     * @param depositAsset The address of the deposit token (collateral for margin trade or
     * locked funds for spot)
     * @param depositAmount The amount of deposit funds for deal
     * @param positionAsset The address output token for exchange
     * @param deadline Unix timestamp after which the order will not be filled
     * @param takeDepositFromWallet Bool, add a collateral deposit within the current transaction
     * @param leverage leverage for trading
     * @param shouldOpenPosition Bool, indicate whether position should be opened
     * @param openingManagerAddresses Array of contract addresses that will be called in canBeFilled
     * @param openingManagerParams Array of bytes representing params for contracts in openingManagerAddresses
     * @param closingManagerAddresses Array of contract addresses that will be called in canBeClosed
     * @param closingManagerParams Array of bytes representing params for contracts in closingManagerAddresses
     */
    struct CreateLimitOrderParams {
        string bucket;
        uint256 depositAmount;
        address depositAsset;
        address positionAsset;
        uint256 deadline;
        bool takeDepositFromWallet;
        uint256 leverage;
        bool shouldOpenPosition;
        Condition[] openConditions;
        Condition[] closeConditions;
        bool isProtocolFeeInPmx;
        bytes nativeDepositAssetOracleData;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
    }

    struct CreateLimitOrderVars {
        bool isSpot;
        IBucketV3 bucket;
        uint256 positionSize;
        address priceOracle;
        uint256 rate;
        IPrimexDNSStorageV3.TradingOrderType tradingOrderType;
        bool isThirdAsset;
    }

    /**
     * @dev Opens a position on an existing order
     * @param orderId order id
     * @param com address of ConditionalOpeningManager
     * @param comAdditionalParams  params needed for ConditionalOpeningManager to calc canBeFilled
     * @param firstAssetMegaRoutes routes to swap first asset
     * @param depositInThirdAssetMegaRoutes routes to swap deposit asset
     */
    struct OpenPositionParams {
        uint256 orderId;
        uint256 conditionIndex;
        bytes comAdditionalParams;
        PrimexPricingLibrary.MegaRoute[] firstAssetMegaRoutes;
        PrimexPricingLibrary.MegaRoute[] depositInThirdAssetMegaRoutes;
        address keeper;
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
        uint256 borrowedAmount;
    }

    struct OpenPositionByOrderVars {
        address assetIn;
        address assetOut;
        uint256 amountIn;
        uint256 amountOut;
        CloseReason closeReason;
        uint256 newPositionId;
        uint256 exchangeRate;
        uint256 feeInPositionAsset;
        uint256 feeInPmx;
    }

    /**
     * @dev Params for PositionManager to open position
     * @param order order
     * @param firstAssetMegaRoutes routes to swap first asset on dex
     * (borrowedAmount + depositAmount if deposit in borrowedAsset)
     * @param depositInThirdAssetMegaRoutes routes to swap deposit in third asset on dex
     */
    struct OpenPositionByOrderParams {
        address sender;
        LimitOrder order;
        Condition[] closeConditions;
        PrimexPricingLibrary.MegaRoute[] firstAssetMegaRoutes;
        PrimexPricingLibrary.MegaRoute[] depositInThirdAssetMegaRoutes;
        bytes firstAssetOracleData;
        bytes thirdAssetOracleData;
        bytes depositSoldAssetOracleData;
        bytes positionUsdOracleData;
        bytes nativePositionAssetOracleData;
        bytes pmxPositionAssetOracleData;
        bytes nativeSoldAssetOracleData;
        uint256 borrowedAmount;
    }

    /**
     * @dev Structure for the updateOrder with parameters necessary to update limit order
     * @param orderId order id to update
     * @param depositAmount The amount of deposit funds for deal
     * @param makeDeposit Bool, add a collateral deposit within the current transaction
     * @param leverage leverage for trading
     * @param takeDepositFromWallet Bool, add a collateral deposit within the current transaction
     */
    struct UpdateLimitOrderParams {
        uint256 orderId;
        uint256 depositAmount;
        uint256 leverage;
        bool isProtocolFeeInPmx;
        bool takeDepositFromWallet;
        bytes nativeDepositOracleData;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
    }

    /**
     * @notice Updates the leverage of a limit order.
     * @param _order The limit order to update.
     * @param _leverage The new leverage value in WAD format for the order.
     * @param _primexDNS The instance of the PrimexDNS contract
     */
    function updateLeverage(LimitOrder storage _order, uint256 _leverage, IPrimexDNSV3 _primexDNS) public {
        _require(_leverage > WadRayMath.WAD, Errors.LEVERAGE_MUST_BE_MORE_THAN_1.selector);
        _require(_order.leverage != WadRayMath.WAD, Errors.CANNOT_CHANGE_SPOT_ORDER_TO_MARGIN.selector);

        _require(
            _leverage <
                _order.bucket.maxAssetLeverage(
                    _order.positionAsset,
                    _primexDNS.getProtocolFeeRateByTier(IPrimexDNSStorageV3.FeeRateType.MarginLimitOrderExecuted, 0) // do not consider the tier here
                ),
            Errors.LEVERAGE_EXCEEDS_MAX_LEVERAGE.selector
        );
        _order.leverage = _leverage;
    }

    /**
     * @notice Updates the deposit details of a LimitOrder.
     * @param _order The LimitOrder to update.
     * @param _amount The amount of the asset being deposited.
     * @param _takeDepositFromWallet Boolean indicating whether to make a deposit or unlock the deposited asset.
     * @param traderBalanceVault The instance of ITraderBalanceVault used for deposit and unlock operations.
     */
    function updateDeposit(
        LimitOrderLibrary.LimitOrder storage _order,
        uint256 _amount,
        bool _takeDepositFromWallet,
        ITraderBalanceVault traderBalanceVault
    ) public {
        depositLockOrUnlock(
            traderBalanceVault,
            _order.depositAsset,
            (_amount > _order.depositAmount) ? _amount - _order.depositAmount : _order.depositAmount - _amount,
            _takeDepositFromWallet,
            _amount > _order.depositAmount
        );
        _order.depositAmount = _amount;
    }

    /**
     * @notice Sets the open conditions for a LimitOrder.
     * @param _order The limit order.
     * @param openConditionsMap The mapping of order IDs to open conditions.
     * @param openConditions The array of open conditions.
     * @param primexDNS The instance of the Primex DNS contract.
     */
    function setOpenConditions(
        LimitOrderLibrary.LimitOrder memory _order,
        mapping(uint256 => Condition[]) storage openConditionsMap,
        Condition[] memory openConditions,
        IPrimexDNSV3 primexDNS
    ) public {
        _require(hasNoConditionManagerTypeDuplicates(openConditions), Errors.SHOULD_NOT_HAVE_DUPLICATES.selector);
        _require(openConditions.length > 0, Errors.SHOULD_HAVE_OPEN_CONDITIONS.selector);
        if (openConditionsMap[_order.id].length > 0) {
            delete openConditionsMap[_order.id];
        }
        Condition memory condition;
        for (uint256 i; i < openConditions.length; i++) {
            condition = openConditions[i];
            _require(
                IERC165Upgradeable(primexDNS.cmTypeToAddress(condition.managerType)).supportsInterface(
                    type(IConditionalOpeningManager).interfaceId
                ),
                Errors.SHOULD_BE_COM.selector
            );
            openConditionsMap[_order.id].push(condition);
        }
    }

    /**
     * @notice Sets the close conditions for a LimitOrder.
     * @param _order The limit order.
     * @param closeConditionsMap The mapping of order IDs to close conditions.
     * @param closeConditions The array of close conditions to set.
     * @param primexDNS The Primex DNS contract address.
     */
    function setCloseConditions(
        LimitOrderLibrary.LimitOrder memory _order,
        mapping(uint256 => Condition[]) storage closeConditionsMap,
        Condition[] memory closeConditions,
        IPrimexDNSV3 primexDNS
    ) public {
        _require(hasNoConditionManagerTypeDuplicates(closeConditions), Errors.SHOULD_NOT_HAVE_DUPLICATES.selector);
        _require(
            _order.shouldOpenPosition || closeConditions.length == 0,
            Errors.SHOULD_NOT_HAVE_CLOSE_CONDITIONS.selector
        );

        if (closeConditionsMap[_order.id].length > 0) {
            delete closeConditionsMap[_order.id];
        }
        Condition memory condition;
        for (uint256 i; i < closeConditions.length; i++) {
            condition = closeConditions[i];
            _require(
                IERC165Upgradeable(primexDNS.cmTypeToAddress(condition.managerType)).supportsInterface(
                    type(IConditionalClosingManager).interfaceId
                ),
                Errors.SHOULD_BE_CCM.selector
            );
            closeConditionsMap[_order.id].push(condition);
        }
    }

    /**
     * @notice Creates a limit order.
     * @param _params The struct containing the order parameters.
     * @param pm The instance of the PositionManager contract.
     * @param traderBalanceVault The instance of the TraderBalanceVault contract.
     * @param primexDNS The instance of the PrimexDNS contract.
     * @return The created limit order.
     */
    function createLimitOrder(
        CreateLimitOrderParams calldata _params,
        IPositionManagerV2 pm,
        ITraderBalanceVault traderBalanceVault,
        IPrimexDNSV3 primexDNS
    ) public returns (LimitOrder memory) {
        _require(_params.leverage >= WadRayMath.WAD, Errors.INCORRECT_LEVERAGE.selector);
        _require(_params.deadline > block.timestamp, Errors.INCORRECT_DEADLINE.selector);

        CreateLimitOrderVars memory vars;
        vars.isSpot = bytes(_params.bucket).length == 0;
        vars.positionSize = _params.depositAmount.wmul(_params.leverage);
        vars.priceOracle = address(pm.priceOracle());
        if (vars.isSpot) {
            _require(_params.leverage == WadRayMath.WAD, Errors.LEVERAGE_SHOULD_BE_1.selector);
            _require(_params.depositAsset != _params.positionAsset, Errors.SHOULD_BE_DIFFERENT_ASSETS_IN_SPOT.selector);
            vars.tradingOrderType = _params.shouldOpenPosition
                ? IPrimexDNSStorageV3.TradingOrderType.SpotLimitOrder
                : IPrimexDNSStorageV3.TradingOrderType.SwapLimitOrder;
        } else {
            _require(_params.shouldOpenPosition, Errors.SHOULD_OPEN_POSITION.selector);
            _require(_params.leverage > WadRayMath.WAD, Errors.LEVERAGE_MUST_BE_MORE_THAN_1.selector);
            vars.bucket = IBucketV3(primexDNS.getBucketAddress(_params.bucket));
            _require(vars.bucket.getLiquidityMiningParams().isBucketLaunched, Errors.BUCKET_IS_NOT_LAUNCHED.selector);

            (, bool tokenAllowed) = vars.bucket.allowedAssets(_params.positionAsset);
            _require(tokenAllowed, Errors.TOKEN_NOT_SUPPORTED.selector);
            _require(
                _params.leverage <
                    vars.bucket.maxAssetLeverage(
                        _params.positionAsset,
                        primexDNS.getProtocolFeeRateByTier(IPrimexDNSStorageV3.FeeRateType.MarginLimitOrderExecuted, 0)
                    ),
                Errors.LEVERAGE_EXCEEDS_MAX_LEVERAGE.selector
            );
            vars.isThirdAsset =
                _params.depositAsset != address(vars.bucket.borrowedAsset()) &&
                _params.depositAsset != _params.positionAsset;
            vars.tradingOrderType = vars.isThirdAsset
                ? IPrimexDNSStorageV3.TradingOrderType.MarginLimitOrderDepositInThirdAsset
                : IPrimexDNSStorageV3.TradingOrderType.MarginLimitOrder;
        }
        LimitOrder memory order = LimitOrder({
            bucket: IBucketV3(address(0)),
            positionAsset: _params.positionAsset,
            depositAsset: _params.depositAsset,
            depositAmount: _params.depositAmount,
            feeToken: _params.isProtocolFeeInPmx ? primexDNS.pmx() : _params.positionAsset,
            protocolFee: 0,
            trader: msg.sender,
            deadline: _params.deadline,
            id: 0,
            leverage: _params.leverage,
            shouldOpenPosition: _params.shouldOpenPosition,
            createdAt: block.timestamp,
            updatedConditionsAt: block.timestamp,
            extraParams: ""
        });
        order.bucket = vars.bucket;

        PrimexPricingLibrary.validateMinPositionSize(
            vars.positionSize,
            order.depositAsset,
            vars.priceOracle,
            pm.keeperRewardDistributor(),
            primexDNS,
            vars.tradingOrderType,
            _params.nativeDepositAssetOracleData
        );

        // deposit locking
        depositLockOrUnlock(
            traderBalanceVault,
            order.depositAsset,
            order.depositAmount,
            _params.takeDepositFromWallet,
            true
        );

        return order;
    }

    /**
     * @notice Opens a position by order.
     * @param order The LimitOrder storage containing order details.
     * @param _params The OpenPositionParams calldata containing additional position parameters.
     * @param _closeConditions The Condition array containing close conditions for the position.
     * @param pm The instance of the PositionManager contract.
     * @param traderBalanceVault The instance of the TraderBalanceVault contract.
     * @param swapManager The instance of the SwapManager contract.
     * @return vars The OpenPositionByOrderVars struct containing the result of the open position operation.
     */
    function openPositionByOrder(
        LimitOrder storage order,
        OpenPositionParams calldata _params,
        Condition[] memory _closeConditions,
        IPositionManagerV2 pm,
        ITraderBalanceVault traderBalanceVault,
        ISwapManager swapManager,
        uint256 _initialGasLeft
    ) public returns (OpenPositionByOrderVars memory) {
        OpenPositionByOrderVars memory vars;
        bool isSpot = address(order.bucket) == address(0);

        if (order.protocolFee != 0) {
            traderBalanceVault.unlockAsset(
                ITraderBalanceVault.UnlockAssetParams({
                    trader: order.trader,
                    receiver: order.trader,
                    asset: order.feeToken,
                    amount: order.protocolFee
                })
            );
            order.protocolFee = 0;
            order.feeToken = order.positionAsset;
        }

        if (order.shouldOpenPosition) {
            vars.closeReason = isSpot ? CloseReason.FilledSpot : CloseReason.FilledMargin;
            (vars.amountIn, vars.amountOut, vars.newPositionId, vars.exchangeRate, vars.feeInPositionAsset) = pm
                .openPositionByOrder(
                    OpenPositionByOrderParams({
                        sender: msg.sender,
                        order: order,
                        closeConditions: _closeConditions,
                        firstAssetMegaRoutes: _params.firstAssetMegaRoutes,
                        depositInThirdAssetMegaRoutes: _params.depositInThirdAssetMegaRoutes,
                        firstAssetOracleData: _params.firstAssetOracleData,
                        thirdAssetOracleData: _params.thirdAssetOracleData,
                        depositSoldAssetOracleData: _params.depositSoldAssetOracleData,
                        positionUsdOracleData: _params.positionUsdOracleData,
                        nativePositionAssetOracleData: _params.nativePositionAssetOracleData,
                        pmxPositionAssetOracleData: _params.pmxPositionAssetOracleData,
                        nativeSoldAssetOracleData: _params.nativeSoldAssetOracleData,
                        borrowedAmount: _params.borrowedAmount
                    })
                );
        } else {
            _require(
                _params.depositInThirdAssetMegaRoutes.length == 0,
                Errors.DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0.selector
            );
            vars.closeReason = CloseReason.FilledSwap;
            vars.amountIn = order.depositAmount;
            traderBalanceVault.unlockAsset(
                ITraderBalanceVault.UnlockAssetParams({
                    trader: order.trader,
                    receiver: address(this),
                    asset: order.depositAsset,
                    amount: order.depositAmount
                })
            );

            (vars.amountOut, vars.feeInPositionAsset) = swapManager.swapInLimitOrder(
                ISwapManager.SwapInLimitOrderParams({
                    depositAsset: order.depositAsset,
                    positionAsset: order.positionAsset,
                    depositAmount: order.depositAmount,
                    megaRoutes: _params.firstAssetMegaRoutes,
                    trader: order.trader,
                    deadline: order.deadline,
                    feeToken: order.feeToken,
                    keeperRewardDistributor: address(pm.keeperRewardDistributor()),
                    gasSpent: _initialGasLeft - gasleft(),
                    depositPositionAssetOracleData: _params.firstAssetOracleData,
                    pmxPositionAssetOracleData: _params.pmxPositionAssetOracleData,
                    nativePositionAssetOracleData: _params.nativePositionAssetOracleData
                }),
                pm.getOracleTolerableLimit(order.depositAsset, order.positionAsset)
            );

            uint256 multiplierDepositAsset = 10 ** (18 - IERC20Metadata(order.depositAsset).decimals());
            uint256 multiplierPositionAsset = 10 ** (18 - IERC20Metadata(order.positionAsset).decimals());
            vars.exchangeRate =
                (vars.amountIn * multiplierDepositAsset).wdiv(
                    (vars.amountOut + vars.feeInPositionAsset) * multiplierPositionAsset
                ) /
                multiplierDepositAsset;
        }

        vars.assetIn = isSpot ? order.depositAsset : address(order.bucket.borrowedAsset());
        vars.assetOut = order.positionAsset;
        return vars;
    }

    /**
     * @notice Checks if an array of Condition structs has no duplicate manager types.
     * @param conditions The array of Condition structs to be checked.
     * @return bool Boolean value indicating whether the array has no duplicate manager types.
     */
    function hasNoConditionManagerTypeDuplicates(Condition[] memory conditions) public pure returns (bool) {
        if (conditions.length == 0) {
            return true;
        }
        for (uint256 i; i < conditions.length - 1; i++) {
            for (uint256 j = i + 1; j < conditions.length; j++) {
                if (conditions[i].managerType == conditions[j].managerType) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * @notice This function is used to either deposit or unlock assets in the trader balance vault.
     * @param traderBalanceVault The instance of the trader balance vault.
     * @param _depositAsset The address of the asset to be deposited or unlocked.
     * @param _amount The amount of the asset to be deposited or unlocked.
     * @param _takeDepositFromWallet Boolean indicating whether to make a deposit or not.
     * @param _isAdd Boolean indicating whether to lock or unlock asset. Should lock asset, if true.
     */
    function depositLockOrUnlock(
        ITraderBalanceVault traderBalanceVault,
        address _depositAsset,
        uint256 _amount,
        bool _takeDepositFromWallet,
        bool _isAdd
    ) internal {
        if (!_isAdd) {
            traderBalanceVault.unlockAsset(
                ITraderBalanceVault.UnlockAssetParams(msg.sender, msg.sender, _depositAsset, _amount)
            );
            return;
        }
        if (_takeDepositFromWallet) {
            if (_depositAsset == NATIVE_CURRENCY) {
                _require(msg.value >= _amount, Errors.INSUFFICIENT_DEPOSIT.selector);
                traderBalanceVault.increaseLockedBalance{value: _amount}(msg.sender, _depositAsset, _amount);
                if (msg.value > _amount) {
                    uint256 rest = msg.value - _amount;
                    traderBalanceVault.topUpAvailableBalance{value: rest}(msg.sender, NATIVE_CURRENCY, rest);
                }
                return;
            }
            TokenTransfersLibrary.doTransferFromTo(_depositAsset, msg.sender, address(traderBalanceVault), _amount);
            traderBalanceVault.increaseLockedBalance(msg.sender, _depositAsset, _amount);
            return;
        }
        traderBalanceVault.useTraderAssets(
            ITraderBalanceVault.LockAssetParams(
                msg.sender,
                address(0),
                _depositAsset,
                _amount,
                ITraderBalanceVault.OpenType.CREATE_LIMIT_ORDER
            )
        );
    }
}
