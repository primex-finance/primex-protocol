// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {WadRayMath} from "./libraries/utils/WadRayMath.sol";

import {PositionLibrary} from "./libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "./libraries/LimitOrderLibrary.sol";
import {PrimexPricingLibrary} from "./libraries/PrimexPricingLibrary.sol";
import "./libraries/Errors.sol";

import {SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN} from "./Constants.sol";
import {IPositionManager} from "./PositionManager/IPositionManager.sol";
import {IPriceOracle} from "./PriceOracle/IPriceOracle.sol";
import {ITakeProfitStopLossCCM} from "./interfaces/ITakeProfitStopLossCCM.sol";
import {ITraderBalanceVault} from "./TraderBalanceVault/ITraderBalanceVault.sol";
import {IBucket} from "./Bucket/IBucket.sol";
import {IBatchManager, IPausable} from "./interfaces/IBatchManager.sol";
import {IWhiteBlackList} from "./WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IKeeperRewardDistributorStorage} from "./KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {IKeeperRewardDistributor} from "./KeeperRewardDistributor/IKeeperRewardDistributor.sol";

contract BatchManager is IBatchManager, ReentrancyGuard, Pausable {
    using WadRayMath for uint256;
    using SafeCast for uint256;

    IPositionManager public immutable override positionManager;
    IPriceOracle public immutable override priceOracle;
    IWhiteBlackList public immutable override whiteBlackList;
    address public immutable override registry;

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

    constructor(
        IPositionManager _positionManager,
        IPriceOracle _priceOracle,
        IWhiteBlackList _whiteBlackList,
        address _registry
    ) {
        _require(
            IERC165Upgradeable(address(_positionManager)).supportsInterface(type(IPositionManager).interfaceId) &&
                IERC165Upgradeable(address(_priceOracle)).supportsInterface(type(IPriceOracle).interfaceId) &&
                IERC165Upgradeable(address(_whiteBlackList)).supportsInterface(type(IWhiteBlackList).interfaceId) &&
                IERC165Upgradeable(address(_registry)).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        whiteBlackList = _whiteBlackList;
        positionManager = _positionManager;
        priceOracle = _priceOracle;
        registry = _registry;
    }

    /**
     * @inheritdoc IBatchManager
     */
    function closeBatchPositions(
        uint256[] calldata _ids,
        PrimexPricingLibrary.Route[] calldata _routes,
        address _positionAsset,
        address _soldAsset,
        IBucket _bucket,
        uint256[] calldata _conditionIndexes,
        PositionLibrary.CloseReason _closeReason
    ) external override nonReentrant notBlackListed whenNotPaused {
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
            positionAmounts: new uint256[](_ids.length),
            debts: new uint256[](_ids.length),
            depositsDecrease: new uint256[](_ids.length),
            decreasingCounter: new uint256[](uint256(type(IKeeperRewardDistributorStorage.DecreasingReason).max) + 1),
            actionType: IKeeperRewardDistributorStorage.KeeperActionType.OpenByOrder, //default value
            numberOfPositions: 0,
            oracleTolerableLimit: positionManager.getOracleTolerableLimit(_soldAsset, _positionAsset),
            securityBuffer: positionManager.securityBuffer(),
            positionManager: positionManager,
            primexDNS: positionManager.primexDNS(),
            priceOracle: priceOracle,
            traderBalanceVault: positionManager.traderBalanceVault(),
            pairPriceDrop: priceOracle.getPairPriceDrop(_positionAsset, _soldAsset),
            closeConditions: new LimitOrderLibrary.Condition[](_ids.length),
            borrowedAmountIsNotZero: address(_bucket) != address(0),
            bucket: address(_bucket),
            totalCloseAmount: 0,
            uncoveredAmount: 0, // a position amount for which the keeper will NOT get the rewards.
            totalDebt: 0,
            adapter: address(0),
            returnedToTraders: new uint256[](0),
            amountToReturn: 0,
            borrowedAssetAmountOut: 0,
            normalizedVariableDebt: 0,
            permanentLoss: 0,
            shareOfBorrowedAssetAmount: new uint256[](0),
            isLiquidation: false
        });

        if (vars.borrowedAmountIsNotZero) {
            _require(address(_bucket.borrowedAsset()) == _soldAsset, Errors.ASSET_ADDRESS_NOT_SUPPORTED.selector);
            vars.normalizedVariableDebt = _bucket.getNormalizedVariableDebt();
        }

        for (uint256 i; i < _ids.length; i++) {
            PositionLibrary.Position memory position;
            //This call can be revert if the id doesn't exist
            try positionManager.getPosition(_ids[i]) returns (PositionLibrary.Position memory _position) {
                position = _position;
            } catch {
                // сounter increase depending on closeReason
                vars.decreasingCounter[
                    uint8(
                        _closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION
                            ? IKeeperRewardDistributorStorage.DecreasingReason.NonExistentIdForLiquidation
                            : IKeeperRewardDistributorStorage.DecreasingReason.NonExistentIdForSLOrTP
                    )
                ]++;
                continue;
            }
            if (!vars.borrowedAmountIsNotZero) {
                _require(position.soldAsset == _soldAsset, Errors.SOLD_ASSET_IS_INCORRECT.selector);
            }
            _require(position.bucket == _bucket, Errors.POSITION_BUCKET_IS_INCORRECT.selector);
            vars.ids[vars.numberOfPositions] = _ids[i];
            _require(position.positionAsset == _positionAsset, Errors.ASSET_ADDRESS_NOT_SUPPORTED.selector);
            vars.positionAmounts[vars.numberOfPositions] = position.positionAmount;
            vars.debts[vars.numberOfPositions] = vars.borrowedAmountIsNotZero
                ? position.scaledDebtAmount.rmul(vars.normalizedVariableDebt)
                : 0;
            vars.depositsDecrease[vars.numberOfPositions] = position.depositAmountInSoldAsset;
            vars.traders[vars.numberOfPositions] = position.trader;
            if (
                _closeReason == PositionLibrary.CloseReason.BATCH_STOP_LOSS ||
                _closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT
            ) {
                vars.closeConditions[vars.numberOfPositions] = positionManager.getCloseCondition(
                    _ids[i],
                    _conditionIndexes[i]
                );
                // to avoid abuse of the reward system, we will not pay the reward to
                // the keeper if the position closes in the same block as the close conditions change
                if (position.updatedConditionsAt == block.timestamp) {
                    vars.decreasingCounter[
                        uint8(IKeeperRewardDistributorStorage.DecreasingReason.ClosePostionInTheSameBlock)
                    ]++;
                    vars.uncoveredAmount += vars.positionAmounts[vars.numberOfPositions];
                }
            }
            vars.numberOfPositions++;
        }

        vars.adapter = vars.primexDNS.dexAdapter();

        if (_closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION) {
            uint256 feeBuffer = _bucket.feeBuffer();
            uint256[] memory borrowedAssetAmounts = PrimexPricingLibrary.getBatchOracleAmountsOut(
                _positionAsset,
                _soldAsset,
                vars.positionAmounts,
                address(vars.priceOracle)
            );
            for (uint256 i; i < vars.numberOfPositions; ) {
                // if the current position is risky that's ok and we increase the counter,
                // if not we have to check this index again because this will be the last position
                if (
                    vars.debts[i] > 0 &&
                    PositionLibrary.health(
                        borrowedAssetAmounts[i],
                        vars.pairPriceDrop,
                        vars.securityBuffer,
                        vars.oracleTolerableLimit,
                        vars.debts[i],
                        feeBuffer
                    ) <
                    WadRayMath.WAD
                ) {
                    vars.totalCloseAmount += vars.positionAmounts[i];
                    vars.totalDebt += vars.debts[i];
                    unchecked {
                        i++;
                    }
                } else {
                    vars.decreasingCounter[
                        uint8(IKeeperRewardDistributorStorage.DecreasingReason.IncorrectConditionForLiquidation)
                    ]++;
                    _removeBatchItem(vars, i);
                }
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.Liquidation;
        } else if (_closeReason == PositionLibrary.CloseReason.BATCH_STOP_LOSS) {
            (uint256 exchangeRate, bool isForward) = vars.priceOracle.getExchangeRate(_positionAsset, _soldAsset);
            if (!isForward) exchangeRate = WadRayMath.WAD.wdiv(exchangeRate);
            uint256 managerType = vars.closeConditions[0].managerType;
            address cm = vars.primexDNS.cmTypeToAddress(managerType);
            _require(
                cm != address(0) && IERC165Upgradeable(cm).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId),
                Errors.CLOSE_CONDITION_IS_NOT_CORRECT.selector
            );
            LimitOrderLibrary.Condition memory condition;
            for (uint256 i; i < vars.numberOfPositions; ) {
                condition = vars.closeConditions[i];
                if (
                    condition.managerType == managerType &&
                    ITakeProfitStopLossCCM(cm).isStopLossReached(condition.params, exchangeRate)
                ) {
                    vars.totalCloseAmount += vars.positionAmounts[i];
                    vars.totalDebt += vars.debts[i];
                    unchecked {
                        i++;
                    }
                } else {
                    vars.decreasingCounter[
                        uint8(IKeeperRewardDistributorStorage.DecreasingReason.IncorrectConditionForSL)
                    ]++;
                    _removeBatchItem(vars, i);
                }
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.StopLoss;
        } else if (_closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT) {
            for (uint256 i; i < vars.numberOfPositions; i++) {
                vars.totalCloseAmount += vars.positionAmounts[i];
                vars.totalDebt += vars.debts[i];
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.TakeProfit;
        } else if (_closeReason == PositionLibrary.CloseReason.BUCKET_DELISTED) {
            _require(_bucket.isDelisted(), Errors.POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector);
            for (uint256 i; i < vars.numberOfPositions; i++) {
                vars.totalCloseAmount += vars.positionAmounts[i];
                vars.totalDebt += vars.debts[i];
            }
            vars.actionType = IKeeperRewardDistributorStorage.KeeperActionType.BucketDelisted;
        } else {
            _revert(Errors.BATCH_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector);
        }
        _require(vars.numberOfPositions > 0, Errors.NOTHING_TO_CLOSE.selector);
        vars.positionManager.doTransferOut(_positionAsset, vars.adapter, vars.totalCloseAmount);
        // overwrite the previous variable from oracle
        vars.borrowedAssetAmountOut = PrimexPricingLibrary.multiSwap(
            PrimexPricingLibrary.MultiSwapParams({
                tokenA: _positionAsset,
                tokenB: _soldAsset,
                amountTokenA: vars.totalCloseAmount,
                routes: _routes,
                dexAdapter: vars.adapter,
                receiver: vars.borrowedAmountIsNotZero ? address(_bucket) : address(vars.traderBalanceVault),
                deadline: block.timestamp
            }),
            vars.oracleTolerableLimit,
            address(vars.primexDNS),
            address(vars.priceOracle),
            true
        );

        // We check TAKE_PROFIT condition only after swap
        if (_closeReason == PositionLibrary.CloseReason.BATCH_TAKE_PROFIT) {
            uint256 multiplierPositionAsset = 10 ** (18 - IERC20Metadata(_positionAsset).decimals());
            uint256 multiplierBorrowedAsset = 10 ** (18 - IERC20Metadata(_soldAsset).decimals());
            uint256 exchangeRate = (vars.borrowedAssetAmountOut * multiplierBorrowedAsset).wdiv(
                vars.totalCloseAmount * multiplierPositionAsset
            );
            uint256 managerType = vars.closeConditions[0].managerType;
            address cm = vars.primexDNS.cmTypeToAddress(managerType);
            _require(
                cm != address(0) && IERC165Upgradeable(cm).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId),
                Errors.CLOSE_CONDITION_IS_NOT_CORRECT.selector
            );
            LimitOrderLibrary.Condition memory condition;
            for (uint256 i; i < vars.numberOfPositions; i++) {
                condition = vars.closeConditions[i];
                _require(
                    condition.managerType == managerType &&
                        ITakeProfitStopLossCCM(cm).isTakeProfitReached(condition.params, exchangeRate),
                    Errors.POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON.selector
                );
            }
        }

        vars.returnedToTraders = new uint256[](vars.numberOfPositions);
        vars.shareOfBorrowedAssetAmount = new uint256[](vars.numberOfPositions);
        vars.isLiquidation = _closeReason == PositionLibrary.CloseReason.BATCH_LIQUIDATION;
        for (uint256 i; i < vars.numberOfPositions; i++) {
            vars.shareOfBorrowedAssetAmount[i] =
                (vars.positionAmounts[i] * vars.borrowedAssetAmountOut) /
                vars.totalCloseAmount;
            if (vars.isLiquidation) continue;
            if (vars.shareOfBorrowedAssetAmount[i] > vars.debts[i]) {
                unchecked {
                    vars.returnedToTraders[i] = vars.shareOfBorrowedAssetAmount[i] - vars.debts[i];
                }
            } else {
                unchecked {
                    vars.permanentLoss += vars.debts[i] - vars.shareOfBorrowedAssetAmount[i];
                }
            }
            vars.amountToReturn += vars.returnedToTraders[i];
        }

        if (vars.isLiquidation) {
            if (vars.borrowedAssetAmountOut > vars.totalDebt) {
                unchecked {
                    vars.amountToReturn = vars.borrowedAssetAmountOut - vars.totalDebt;
                }
            } else {
                unchecked {
                    vars.permanentLoss = vars.totalDebt - vars.borrowedAssetAmountOut;
                }
            }
        } else {
            vars.traderBalanceVault.batchTopUpAvailableBalance(
                ITraderBalanceVault.BatchTopUpAvailableBalanceParams({
                    traders: vars.traders,
                    asset: _soldAsset,
                    amounts: vars.returnedToTraders,
                    length: vars.numberOfPositions
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
                vars.numberOfPositions
            );
        }

        positionManager.deletePositions(vars.ids, vars.traders, vars.numberOfPositions, vars.bucket);
        for (uint256 i; i < vars.numberOfPositions; i++) {
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
                amountOut: vars.shareOfBorrowedAssetAmount[i],
                reason: _closeReason
            });
        }
        if (vars.totalCloseAmount.toInt256() - vars.uncoveredAmount.toInt256() > 0) {
            positionManager.keeperRewardDistributor().updateReward(
                IKeeperRewardDistributor.UpdateRewardParams({
                    keeper: msg.sender,
                    positionAsset: _positionAsset,
                    positionSize: vars.totalCloseAmount - vars.uncoveredAmount,
                    action: vars.actionType,
                    numberOfActions: vars.numberOfPositions,
                    gasSpent: initialGasleft - gasleft(),
                    decreasingCounter: vars.decreasingCounter,
                    routesLength: abi.encode(_routes).length
                })
            );
        }
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

    /**
     * @notice Removes item from array
     * @dev The item is not deleted but swapped with the last item
     * @param  vars  The struct containing arrays to update
     * @param  index  The index of the item to remove
     */
    function _removeBatchItem(CloseBatchPositionsVars memory vars, uint256 index) internal pure {
        //swap with the last one
        vars.ids[index] = vars.ids[vars.numberOfPositions - 1];
        vars.traders[index] = vars.traders[vars.numberOfPositions - 1];
        vars.positionAmounts[index] = vars.positionAmounts[vars.numberOfPositions - 1];
        vars.debts[index] = vars.debts[vars.numberOfPositions - 1];
        vars.depositsDecrease[index] = vars.depositsDecrease[vars.numberOfPositions - 1];
        //this will work like pop() for an array
        unchecked {
            vars.numberOfPositions--;
        }
    }
}
