// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";
import {BatchManagerStorage, IERC165Upgradeable, IPositionManagerV2, IWhiteBlackList} from "./BatchManagerStorage.sol";
import {MEDIUM_TIMELOCK_ADMIN, BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN} from "../Constants.sol";
import "../libraries/Errors.sol";

import {IBatchManager, IPausable} from "./IBatchManager.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {ITakeProfitStopLossCCM} from "../interfaces/ITakeProfitStopLossCCM.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IKeeperRewardDistributorV3, IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNSStorage.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";

contract BatchManager is IBatchManager, BatchManagerStorage {
    using WadRayMath for uint256;
    using SafeCast for uint256;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @dev Modifier to check if the sender is not blacklisted.
     */
    modifier notBlackListed() {
        _require(!whiteBlackList.isBlackListed(msg.sender), Errors.SENDER_IS_BLACKLISTED.selector);
        _;
    }

    /**
     * @inheritdoc IBatchManager
     */
    function initialize(address _registry) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
    }

    function initializeAfterUpgrade(
        address _positionManager,
        address _priceOracle,
        address _whiteBlackList,
        uint256 _gasPerPosition,
        uint256 _gasPerBatch
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) reinitializer(2) {
        _require(
            IERC165Upgradeable(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId) &&
                IERC165Upgradeable(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        positionManager = IPositionManagerV2(_positionManager);
        priceOracle = IPriceOracleV2(_priceOracle);
        _setGasPerPosition(_gasPerPosition);
        _setGasPerBatch(_gasPerBatch);
    }

    /**
     * @inheritdoc IBatchManager
     */
    function setGasPerPosition(uint256 _newGasPerPosition) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _setGasPerPosition(_newGasPerPosition);
    }

    /**
     * @inheritdoc IBatchManager
     */
    function setGasPerBatch(uint256 _newGasPerBatch) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _setGasPerBatch(_newGasPerBatch);
    }

    /**
     * @inheritdoc IBatchManager
     */
    function closeBatchPositions(
        uint256[] calldata _ids,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        address _positionAsset,
        address _soldAsset,
        IBucketV3 _bucket,
        uint256[] calldata _conditionIndexes,
        PositionLibrary.CloseReason _closeReason,
        bytes calldata _positionSoldAssetOracleData,
        bytes calldata _nativePmxOracleData,
        bytes calldata _nativeSoldAssetOracleData,
        bytes calldata _positionNativeAssetOracleData,
        bytes calldata _pmxSoldAssetOracleData,
        bytes[][] calldata _pullOracleData,
        uint256[] calldata _pullOracleTypes
    ) external payable override nonReentrant notBlackListed whenNotPaused {
        uint256 initialGasleft = gasleft();
        _require(_ids.length > 0, Errors.THERE_MUST_BE_AT_LEAST_ONE_POSITION.selector);
        if (
            _closeReason == PositionLibrary.CloseReason.BATCH_STOP_LOSS ||
            _closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT
        ) {
            _require(_ids.length == _conditionIndexes.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        }
        CloseBatchPositionsVars memory vars = CloseBatchPositionsVars({
            ids: new uint256[](_ids.length),
            traders: new address[](_ids.length),
            feeTokens: new address[](_ids.length),
            positionAmounts: new uint256[](_ids.length),
            debts: new uint256[](_ids.length),
            depositsDecrease: new uint256[](_ids.length),
            decreasingCounter: new uint256[](uint256(type(IKeeperRewardDistributorStorage.DecreasingReason).max) + 1),
            actionType: IKeeperRewardDistributorStorage.KeeperActionType.OpenByOrder, //default value
            oracleTolerableLimit: positionManager.getOracleTolerableLimit(_soldAsset, _positionAsset),
            securityBuffer: positionManager.securityBuffer(),
            positionManager: positionManager,
            primexDNS: positionManager.primexDNS(),
            priceOracle: priceOracle,
            keeperRewardDistributor: positionManager.keeperRewardDistributor(),
            traderBalanceVault: positionManager.traderBalanceVault(),
            pairPriceDrop: priceOracle.getPairPriceDrop(_positionAsset, _soldAsset),
            closeConditions: new LimitOrderLibrary.Condition[](_ids.length),
            borrowedAmountIsNotZero: address(_bucket) != address(0),
            bucket: address(_bucket),
            totalCloseAmount: 0,
            uncoveredAmount: 0, // a position amount for which the keeper will NOT get the rewards.
            totalDebt: 0,
            adapter: payable(0),
            returnedToTraders: new uint256[](0),
            amountToReturn: 0,
            positionAmountInBorrowedAsset: 0,
            positionAmountInBorrowedAssetAfterFee: 0,
            normalizedVariableDebt: 0,
            permanentLoss: 0,
            shareOfBorrowedAssetAmount: new uint256[](0),
            isLiquidation: false,
            feeInPaymentAsset: new uint256[](_ids.length),
            feeInPmx: new uint256[](_ids.length),
            totalFeeInPaymentAsset: 0
        });

        vars.priceOracle.updatePullOracle{value: msg.value}(_pullOracleData, _pullOracleTypes);
        if (vars.borrowedAmountIsNotZero) {
            _require(address(_bucket.borrowedAsset()) == _soldAsset, Errors.ASSET_ADDRESS_NOT_SUPPORTED.selector);
            vars.normalizedVariableDebt = _bucket.getNormalizedVariableDebt();
        }

        for (uint256 i; i < _ids.length; i++) {
            PositionLibrary.Position memory position;
            position = positionManager.getPosition(_ids[i]);
            if (!vars.borrowedAmountIsNotZero) {
                _require(position.soldAsset == _soldAsset, Errors.SOLD_ASSET_IS_INCORRECT.selector);
            }
            _require(position.bucket == _bucket, Errors.POSITION_BUCKET_IS_INCORRECT.selector);
            vars.ids[i] = _ids[i];
            _require(position.positionAsset == _positionAsset, Errors.ASSET_ADDRESS_NOT_SUPPORTED.selector);
            vars.positionAmounts[i] = position.positionAmount;
            vars.debts[i] = vars.borrowedAmountIsNotZero
                ? position.scaledDebtAmount.rmul(vars.normalizedVariableDebt)
                : 0;
            vars.depositsDecrease[i] = position.depositAmountInSoldAsset;
            vars.traders[i] = position.trader;
            vars.feeTokens[i] = PositionLibrary.decodeFeeTokenAddress(position.extraParams);
            if (
                _closeReason == PositionLibrary.CloseReason.BATCH_STOP_LOSS ||
                _closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT
            ) {
                vars.closeConditions[i] = positionManager.getCloseCondition(_ids[i], _conditionIndexes[i]);
                // to avoid abuse of the reward system, we will not pay the reward to
                // the keeper if the position closes in the same block as the close conditions change
                if (position.updatedConditionsAt == block.timestamp) {
                    vars.decreasingCounter[
                        uint8(IKeeperRewardDistributorStorage.DecreasingReason.ClosePostionInTheSameBlock)
                    ]++;
                    vars.uncoveredAmount += vars.positionAmounts[i];
                }
            }
            vars.totalCloseAmount += vars.positionAmounts[i];
            vars.totalDebt += vars.debts[i];
        }

        vars.adapter = payable(vars.primexDNS.dexAdapter());

        CloseBatchPositionsLocalData memory data;
        if (_closeReason == PositionLibrary.CloseReason.BATCH_STOP_LOSS) {
            data.exchangeRate = vars.priceOracle.getExchangeRate(
                _positionAsset,
                _soldAsset,
                _positionSoldAssetOracleData
            );
            data.managerType = vars.closeConditions[0].managerType;
            data.cm = vars.primexDNS.cmTypeToAddress(data.managerType);
            _require(
                data.cm != address(0) &&
                    IERC165Upgradeable(data.cm).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId),
                Errors.CLOSE_CONDITION_IS_NOT_CORRECT.selector
            );
            LimitOrderLibrary.Condition memory condition;

            for (uint256 i; i < _ids.length; i++) {
                condition = vars.closeConditions[i];
                _require(
                    condition.managerType == data.managerType &&
                        ITakeProfitStopLossCCM(data.cm).isStopLossReached(condition.params, data.exchangeRate),
                    Errors.POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector
                );
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.StopLoss;
        } else if (_closeReason == PositionLibrary.CloseReason.BUCKET_DELISTED) {
            _require(_bucket.isDelisted(), Errors.POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector);
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.BucketDelisted;
        } else if (
            _closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT ||
            _closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION
        ) {} else {
            _revert(Errors.BATCH_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector);
        }
        vars.positionManager.doTransferOut(_positionAsset, vars.adapter, vars.totalCloseAmount);

        // overwrite the previous variable from oracle
        vars.positionAmountInBorrowedAsset = PrimexPricingLibrary.megaSwap(
            PrimexPricingLibrary.MegaSwapParams({
                tokenA: _positionAsset,
                tokenB: _soldAsset,
                amountTokenA: vars.totalCloseAmount,
                megaRoutes: _megaRoutes,
                receiver: address(this),
                deadline: block.timestamp
            }),
            vars.oracleTolerableLimit,
            vars.adapter,
            address(vars.priceOracle),
            true,
            _positionSoldAssetOracleData
        );
        vars.returnedToTraders = new uint256[](_ids.length);
        vars.shareOfBorrowedAssetAmount = new uint256[](_ids.length);
        vars.isLiquidation = _closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION;
        for (uint256 i; i < _ids.length; i++) {
            vars.shareOfBorrowedAssetAmount[i] =
                (vars.positionAmounts[i] * vars.positionAmountInBorrowedAsset) /
                vars.totalCloseAmount;
        }

        (vars.feeInPaymentAsset, vars.feeInPmx) = PrimexPricingLibrary.payProtocolFeeBatchClose(
            PrimexPricingLibrary.ProtocolFeeParamsBatchClose({
                numberOfPositions: _ids.length,
                feeTokens: vars.feeTokens,
                traders: vars.traders,
                paymentAmounts: vars.shareOfBorrowedAssetAmount,
                paymentAsset: _soldAsset,
                priceOracle: address(vars.priceOracle),
                feeRateType: vars.borrowedAmountIsNotZero
                    ? IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByKeeper
                    : IPrimexDNSStorageV3.FeeRateType.SpotPositionClosedByKeeper,
                traderBalanceVault: vars.traderBalanceVault,
                keeperRewardDistributor: address(vars.keeperRewardDistributor),
                primexDNS: vars.primexDNS,
                estimatedGasAmount: _approxGasAmount(_ids.length),
                estimatedBaseLength: _calculateEstimatedBaseLength(_ids.length),
                isFeeProhibitedInPmx: _closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION,
                nativePaymentAssetOracleData: _nativeSoldAssetOracleData,
                pmxPaymentAssetOracleData: _pmxSoldAssetOracleData
            })
        );

        if (_closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION) {
            data.feeBuffer = _bucket.feeBuffer();
            data.positionAmountInBorrowedAsset = PrimexPricingLibrary.getBatchOracleAmountsOut(
                _positionAsset,
                _soldAsset,
                vars.positionAmounts,
                address(vars.priceOracle),
                _positionSoldAssetOracleData
            );
            for (uint256 i; i < _ids.length; i++) {
                _require(
                    vars.debts[i] > 0 &&
                        PositionLibrary.health(
                            data.positionAmountInBorrowedAsset[i] - vars.feeInPaymentAsset[i],
                            vars.pairPriceDrop,
                            vars.securityBuffer,
                            vars.oracleTolerableLimit,
                            vars.debts[i],
                            data.feeBuffer
                        ) <
                        WadRayMath.WAD,
                    Errors.POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector
                );
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.Liquidation;
        }

        if (_closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT) {
            data.multiplierPositionAsset = 10 ** (18 - IERC20Metadata(_positionAsset).decimals());
            data.multiplierBorrowedAsset = 10 ** (18 - IERC20Metadata(_soldAsset).decimals());
            data.exchangeRate = (vars.positionAmountInBorrowedAsset * data.multiplierBorrowedAsset).wdiv(
                vars.totalCloseAmount * data.multiplierPositionAsset
            );
            data.managerType = vars.closeConditions[0].managerType;
            data.cm = vars.primexDNS.cmTypeToAddress(data.managerType);
            _require(
                data.cm != address(0) &&
                    IERC165Upgradeable(data.cm).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId),
                Errors.CLOSE_CONDITION_IS_NOT_CORRECT.selector
            );
            LimitOrderLibrary.Condition memory condition;
            for (uint256 i; i < _ids.length; i++) {
                condition = vars.closeConditions[i];
                _require(
                    condition.managerType == data.managerType &&
                        ITakeProfitStopLossCCM(data.cm).isTakeProfitReached(condition.params, data.exchangeRate),
                    Errors.POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector
                );
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.TakeProfit;
        }

        for (uint256 i; i < _ids.length; i++) {
            vars.totalFeeInPaymentAsset += vars.feeInPaymentAsset[i];
            if (vars.isLiquidation) continue;
            if (vars.shareOfBorrowedAssetAmount[i] > vars.debts[i]) {
                unchecked {
                    vars.returnedToTraders[i] =
                        vars.shareOfBorrowedAssetAmount[i] -
                        vars.debts[i] -
                        vars.feeInPaymentAsset[i];
                }
            } else {
                unchecked {
                    vars.permanentLoss +=
                        vars.debts[i] +
                        vars.feeInPaymentAsset[i] -
                        vars.shareOfBorrowedAssetAmount[i];
                }
            }
            vars.amountToReturn += vars.returnedToTraders[i];
        }

        vars.positionAmountInBorrowedAssetAfterFee = vars.positionAmountInBorrowedAsset - vars.totalFeeInPaymentAsset;
        TokenTransfersLibrary.doTransferOut({
            token: _soldAsset,
            to: vars.primexDNS.treasury(),
            amount: vars.totalFeeInPaymentAsset
        });

        TokenTransfersLibrary.doTransferOut({
            token: _soldAsset,
            to: vars.borrowedAmountIsNotZero ? address(_bucket) : address(vars.traderBalanceVault),
            amount: vars.positionAmountInBorrowedAsset - vars.totalFeeInPaymentAsset
        });

        if (vars.isLiquidation) {
            if (vars.positionAmountInBorrowedAssetAfterFee > vars.totalDebt) {
                unchecked {
                    vars.amountToReturn = vars.positionAmountInBorrowedAssetAfterFee - vars.totalDebt;
                }
            } else {
                unchecked {
                    vars.permanentLoss = vars.totalDebt - vars.positionAmountInBorrowedAssetAfterFee;
                }
            }
        } else {
            vars.traderBalanceVault.batchTopUpAvailableBalance(
                ITraderBalanceVault.BatchTopUpAvailableBalanceParams({
                    traders: vars.traders,
                    asset: _soldAsset,
                    amounts: vars.returnedToTraders,
                    length: _ids.length
                })
            );
        }

        if (vars.borrowedAmountIsNotZero) {
            _bucket.batchDecreaseTradersDebt(
                vars.traders,
                vars.debts,
                vars.isLiquidation ? vars.primexDNS.treasury() : address(vars.traderBalanceVault),
                vars.amountToReturn,
                vars.permanentLoss,
                _ids.length
            );
        }

        positionManager.deletePositions(vars.ids, vars.traders, _ids.length, vars.bucket);
        for (uint256 i; i < _ids.length; i++) {
            emit PositionLibrary.ClosePosition({
                positionId: vars.ids[i],
                trader: vars.traders[i],
                closedBy: msg.sender,
                bucketAddress: address(_bucket),
                soldAsset: _soldAsset,
                positionAsset: _positionAsset,
                decreasePositionAmount: vars.positionAmounts[i],
                profit: vars.returnedToTraders[i].toInt256() - vars.depositsDecrease[i].toInt256(),
                positionDebt: vars.debts[i],
                amountOut: vars.shareOfBorrowedAssetAmount[i] - vars.feeInPaymentAsset[i],
                reason: _closeReason
            });
            emit PositionLibrary.PaidProtocolFee({
                positionId: vars.ids[i],
                trader: vars.traders[i],
                paymentAsset: _soldAsset,
                feeRateType: vars.borrowedAmountIsNotZero
                    ? IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByKeeper
                    : IPrimexDNSStorageV3.FeeRateType.SpotPositionClosedByKeeper,
                feeInPaymentAsset: vars.feeInPaymentAsset[i],
                feeInPmx: vars.feeInPmx[i]
            });
        }
        if (vars.totalCloseAmount.toInt256() - vars.uncoveredAmount.toInt256() > 0) {
            vars.keeperRewardDistributor.updateReward(
                IKeeperRewardDistributorV3.UpdateRewardParams({
                    keeper: msg.sender,
                    positionAsset: _positionAsset,
                    positionSize: vars.totalCloseAmount - vars.uncoveredAmount,
                    action: vars.actionType,
                    numberOfActions: _ids.length,
                    gasSpent: initialGasleft - gasleft(),
                    decreasingCounter: vars.decreasingCounter,
                    routesLength: abi.encode(_megaRoutes).length,
                    nativePmxOracleData: _nativePmxOracleData,
                    positionNativeAssetOracleData: _positionNativeAssetOracleData
                })
            );
        }
    }

    /**
     * @notice Interface checker
     * @param interfaceId The interface id to check
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IBatchManager).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @inheritdoc IPausable
     */
    function pause() external override onlyRole(EMERGENCY_ADMIN) {
        _pause();
    }

    /**
     * @inheritdoc IPausable
     */
    function unpause() external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _unpause();
    }

    function _setGasPerPosition(uint256 _newGasPerPosition) internal {
        gasPerPosition = _newGasPerPosition;
        emit ChangeGasPerPosition(_newGasPerPosition);
    }

    function _setGasPerBatch(uint256 _newGasPerBatch) internal {
        gasPerBatch = _newGasPerBatch;
        emit ChangeGasPerBatch(_newGasPerBatch);
    }

    /**
     * @notice Calculate approx gas amount per 1 position of the batch size
     * @param _numberOfPositions The batch size
     */
    function _approxGasAmount(uint256 _numberOfPositions) internal view returns (uint256 estimatedGasAmount) {
        estimatedGasAmount = gasPerBatch / (_numberOfPositions) + gasPerPosition;
    }

    function _calculateEstimatedBaseLength(
        uint256 _numberOfPositions
    ) internal view returns (uint256 estimatedBaseLength) {
        (, uint256 baseLength) = positionManager.primexDNS().minFeeRestrictions(
            IPrimexDNSStorageV3.CallingMethod.ClosePositionByCondition
        );
        estimatedBaseLength = 64 + baseLength / _numberOfPositions;
    }
}
