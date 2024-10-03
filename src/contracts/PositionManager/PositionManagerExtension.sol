// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import "../libraries/Errors.sol";

import "../Constants.sol";
import {PositionManagerStorageV2} from "../PositionManager/PositionManagerStorage.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPositionManagerExtension} from "./IPositionManagerExtension.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNSStorage.sol";
import {ISpotTradingRewardDistributorV2} from "../SpotTradingRewardDistributor/ISpotTradingRewardDistributor.sol";

contract PositionManagerExtension is IPositionManagerExtension, PositionManagerStorageV2 {
    using WadRayMath for uint256;
    using PositionLibrary for PositionLibrary.Position;

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setMaxPositionSize(
        address _token0,
        address _token1,
        uint256 _amountInToken0,
        uint256 _amountInToken1
    ) external override {
        _onlyRole(SMALL_TIMELOCK_ADMIN);
        PositionLibrary.setMaxPositionSize(maxPositionSize, _token0, _token1, _amountInToken0, _amountInToken1);
        emit SetMaxPositionSize(_token0, _token1, _amountInToken0, _amountInToken1);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */

    function setMaxPositionSizes(MaxPositionSizeParams[] calldata _params) external override {
        _onlyRole(SMALL_TIMELOCK_ADMIN);
        for (uint256 i; i < _params.length; i++) {
            PositionLibrary.setMaxPositionSize(
                maxPositionSize,
                _params[i].token0,
                _params[i].token1,
                _params[i].amountInToken0,
                _params[i].amountInToken1
            );
            emit SetMaxPositionSize(
                _params[i].token0,
                _params[i].token1,
                _params[i].amountInToken0,
                _params[i].amountInToken1
            );
        }
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setDefaultOracleTolerableLimit(uint256 _percent) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        _require(_percent <= WadRayMath.WAD, Errors.INVALID_PERCENT_NUMBER.selector);
        defaultOracleTolerableLimit = _percent;
        emit SetDefaultOracleTolerableLimit(_percent);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setSecurityBuffer(uint256 _newSecurityBuffer) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        _require(_newSecurityBuffer < WadRayMath.WAD, Errors.INVALID_SECURITY_BUFFER.selector);
        securityBuffer = _newSecurityBuffer;
        emit SecurityBufferChanged(_newSecurityBuffer);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setMaintenanceBuffer(uint256 _newMaintenanceBuffer) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        _require(
            _newMaintenanceBuffer > 0 && _newMaintenanceBuffer < WadRayMath.WAD,
            Errors.INVALID_MAINTENANCE_BUFFER.selector
        );
        maintenanceBuffer = _newMaintenanceBuffer;
        emit MaintenanceBufferChanged(_newMaintenanceBuffer);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setOracleTolerableLimit(address _assetA, address _assetB, uint256 _percent) external override {
        _onlyRole(SMALL_TIMELOCK_ADMIN);
        PositionLibrary.setOracleTolerableLimit(oracleTolerableLimits, _assetA, _assetB, _percent);
        emit SetOracleTolerableLimit(_assetA, _assetB, _percent);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setOracleTolerableLimits(OracleTolerableLimitsParams[] calldata _limitParams) external override {
        _onlyRole(SMALL_TIMELOCK_ADMIN);
        for (uint256 i; i < _limitParams.length; i++) {
            PositionLibrary.setOracleTolerableLimit(
                oracleTolerableLimits,
                _limitParams[i].assetA,
                _limitParams[i].assetB,
                _limitParams[i].percent
            );
            emit SetOracleTolerableLimit(_limitParams[i].assetA, _limitParams[i].assetB, _limitParams[i].percent);
        }
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setOracleTolerableLimitMultiplier(uint256 newMultiplier) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        _require(
            newMultiplier >= WadRayMath.WAD && newMultiplier < 10 * WadRayMath.WAD,
            Errors.WRONG_TRUSTED_MULTIPLIER.selector
        );

        oracleTolerableLimitMultiplier = newMultiplier;
        emit OracleTolerableLimitMultiplierChanged(newMultiplier);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setKeeperRewardDistributor(IKeeperRewardDistributorV3 _keeperRewardDistributor) external override {
        _onlyRole(BIG_TIMELOCK_ADMIN);
        _require(
            IERC165Upgradeable(address(_keeperRewardDistributor)).supportsInterface(
                type(IKeeperRewardDistributorV3).interfaceId
            ),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        keeperRewardDistributor = _keeperRewardDistributor;
        emit KeeperRewardDistributorChanged(address(_keeperRewardDistributor));
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function setSpotTradingRewardDistributor(address _spotTradingRewardDistributor) external override {
        _onlyRole(BIG_TIMELOCK_ADMIN);
        spotTradingRewardDistributor = ISpotTradingRewardDistributorV2(_spotTradingRewardDistributor);
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    function _onlyRole(bytes32 _role) internal view {
        _require(registry.hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function openPositionByOrder(
        LimitOrderLibrary.OpenPositionByOrderParams calldata _params
    ) external override whenNotPaused returns (uint256, uint256, uint256, uint256, uint256) {
        _onlyRole(LOM_ROLE);
        uint256 initialGasleft = gasleft();
        (PositionLibrary.Position memory newPosition, PositionLibrary.OpenPositionVars memory vars) = PositionLibrary
            .createPositionByOrder(_params, priceOracle, primexDNS);
        PositionLibrary.OpenPositionEventData memory posEventData = _openPosition(newPosition, vars, initialGasleft);

        PositionLibrary.Position memory position = positions[positions.length - 1];

        emit OpenPosition({
            positionId: position.id,
            trader: _params.order.trader,
            openedBy: _params.sender,
            position: position,
            entryPrice: posEventData.entryPrice,
            leverage: posEventData.leverage,
            closeConditions: vars.closeConditions
        });
        emit PositionLibrary.PaidProtocolFee({
            positionId: position.id,
            trader: _params.order.trader,
            paymentAsset: position.positionAsset,
            feeRateType: posEventData.feeRateType,
            feeInPaymentAsset: posEventData.feeInPositionAsset,
            feeInPmx: posEventData.feeInPmx
        });

        return (
            vars.borrowedAmount + position.depositAmountInSoldAsset,
            position.positionAmount,
            position.id,
            posEventData.entryPrice,
            posEventData.feeInPositionAsset
        );
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function openPosition(
        PositionLibrary.OpenPositionParams calldata _params
    ) external payable override nonReentrant whenNotPaused {
        _notBlackListed();
        priceOracle.updatePullOracle{value: msg.value}(_params.pullOracleData, _params.pullOracleTypes);
        (PositionLibrary.Position memory newPosition, PositionLibrary.OpenPositionVars memory vars) = PositionLibrary
            .createPosition(_params, primexDNS, priceOracle);
        PositionLibrary.OpenPositionEventData memory posEventData = _openPosition(newPosition, vars, 0);

        PositionLibrary.Position memory position = positions[positions.length - 1];

        emit OpenPosition({
            positionId: position.id,
            trader: position.trader,
            openedBy: position.trader,
            position: position,
            entryPrice: posEventData.entryPrice,
            leverage: posEventData.leverage,
            closeConditions: vars.closeConditions
        });
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function partiallyClosePosition(
        uint256 _positionId,
        uint256 _amount,
        address _depositReceiver,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin,
        bytes calldata _positionSoldAssetOracleData,
        bytes calldata _nativePositionAssetOracleData,
        bytes calldata _nativeSoldAssetOracleData,
        bytes calldata _pmxSoldAssetOracleData,
        bytes[][] calldata _pullOracleData,
        uint256[] calldata _pullOracleTypes
    ) external payable override nonReentrant {
        _notBlackListed();
        _onlyExist(_positionId);
        PositionLibrary.Position memory position = positions[positionIndexes[_positionId]];
        _require(msg.sender == position.trader, Errors.CALLER_IS_NOT_TRADER.selector);
        _require(_amount < position.positionAmount, Errors.AMOUNT_IS_MORE_THAN_POSITION_AMOUNT.selector);
        priceOracle.updatePullOracle{value: msg.value}(_pullOracleData, _pullOracleTypes);
        PositionLibrary.ScaledParams memory scaledParams;
        scaledParams.borrowedAmountIsNotZero = position.scaledDebtAmount != 0;
        scaledParams.decreasePercent = _amount.wdiv(position.positionAmount);
        scaledParams.scaledDebtAmount = scaledParams.borrowedAmountIsNotZero
            ? position.scaledDebtAmount.wmul(scaledParams.decreasePercent)
            : 0;
        scaledParams.depositDecrease = position.depositAmountInSoldAsset.wmul(scaledParams.decreasePercent);
        LimitOrderLibrary.Condition memory condition;
        PositionLibrary.ClosePositionEventData memory posEventData = position.closePosition(
            PositionLibrary.ClosePositionParams({
                closeAmount: _amount,
                depositDecrease: scaledParams.depositDecrease,
                scaledDebtAmount: scaledParams.scaledDebtAmount,
                depositReceiver: _depositReceiver,
                megaRoutes: _megaRoutes,
                amountOutMin: _amountOutMin,
                oracleTolerableLimit: scaledParams.borrowedAmountIsNotZero
                    ? getOracleTolerableLimit(position.positionAsset, position.soldAsset)
                    : 0,
                primexDNS: primexDNS,
                priceOracle: priceOracle,
                traderBalanceVault: traderBalanceVault,
                closeCondition: condition,
                ccmAdditionalParams: "",
                borrowedAmountIsNotZero: scaledParams.borrowedAmountIsNotZero,
                pairPriceDrop: priceOracle.getPairPriceDrop(position.positionAsset, position.soldAsset),
                securityBuffer: securityBuffer,
                needOracleTolerableLimitCheck: scaledParams.borrowedAmountIsNotZero,
                initialGasLeft: 0,
                keeperRewardDistributor: address(0),
                positionSoldAssetOracleData: _positionSoldAssetOracleData,
                pmxSoldAssetOracleData: _pmxSoldAssetOracleData,
                nativeSoldAssetOracleData: _nativeSoldAssetOracleData
            }),
            PositionLibrary.CloseReason.CLOSE_BY_TRADER
        );
        position.positionAmount -= _amount;
        position.scaledDebtAmount -= scaledParams.scaledDebtAmount;
        position.depositAmountInSoldAsset -= scaledParams.depositDecrease;

        // isSpot = address(position.bucket) == address(0)
        IPrimexDNSStorageV3.TradingOrderType tradingOrderType = address(position.bucket) == address(0)
            ? IPrimexDNSStorageV3.TradingOrderType.SpotMarketOrder
            : IPrimexDNSStorageV3.TradingOrderType.MarginMarketOrder;

        PrimexPricingLibrary.validateMinPositionSize(
            position.positionAmount,
            position.positionAsset,
            address(priceOracle),
            keeperRewardDistributor,
            primexDNS,
            tradingOrderType,
            _nativePositionAssetOracleData
        );

        positions[positionIndexes[_positionId]] = position;
        emit PartialClosePosition({
            positionId: _positionId,
            trader: msg.sender,
            bucketAddress: address(position.bucket),
            soldAsset: position.soldAsset,
            positionAsset: position.positionAsset,
            decreasePositionAmount: _amount,
            depositedAmount: position.depositAmountInSoldAsset,
            scaledDebtAmount: position.scaledDebtAmount,
            profit: posEventData.profit,
            positionDebt: posEventData.debtAmount,
            amountOut: posEventData.amountOutAfterFee
        });
        emit PositionLibrary.PaidProtocolFee({
            positionId: _positionId,
            trader: msg.sender,
            paymentAsset: posEventData.paymentAsset,
            feeRateType: posEventData.feeRateType,
            feeInPaymentAsset: posEventData.feeInPaymentAsset,
            feeInPmx: posEventData.feeInPmx
        });
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function decreaseDeposit(
        uint256 _positionId,
        uint256 _amount,
        bytes calldata _positionSoldAssetOracleData,
        bytes calldata _nativeSoldAssetOracleData,
        bytes[][] calldata _pullOracleData,
        uint256[] calldata _pullOracleTypes
    ) external payable override nonReentrant whenNotPaused {
        _notBlackListed();
        PositionLibrary.Position storage position = positions[positionIndexes[_positionId]];
        priceOracle.updatePullOracle{value: msg.value}(_pullOracleData, _pullOracleTypes);
        position.decreaseDeposit(
            PositionLibrary.DecreaseDepositParams({
                amount: _amount,
                primexDNS: primexDNS,
                priceOracle: priceOracle,
                traderBalanceVault: traderBalanceVault,
                pairPriceDrop: priceOracle.getPairPriceDrop(position.positionAsset, position.soldAsset),
                securityBuffer: securityBuffer,
                oracleTolerableLimit: getOracleTolerableLimit(position.positionAsset, position.soldAsset),
                maintenanceBuffer: maintenanceBuffer,
                keeperRewardDistributor: address(keeperRewardDistributor),
                positionSoldAssetOracleData: _positionSoldAssetOracleData,
                nativeSoldAssetOracleData: _nativeSoldAssetOracleData
            })
        );
        emit DecreaseDeposit({
            positionId: position.id,
            trader: position.trader,
            depositDelta: _amount,
            scaledDebtAmount: position.scaledDebtAmount
        });
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function updatePositionConditions(
        uint256 _positionId,
        LimitOrderLibrary.Condition[] calldata _closeConditions
    ) external override nonReentrant {
        _notBlackListed();
        PositionLibrary.Position storage position = positions[positionIndexes[_positionId]];
        _require(msg.sender == position.trader, Errors.CALLER_IS_NOT_TRADER.selector);

        if (keccak256(abi.encode(_closeConditions)) != keccak256(abi.encode(closeConditions[_positionId]))) {
            position.setCloseConditions(closeConditions, _closeConditions, primexDNS);
            position.updatedConditionsAt = block.timestamp;
            emit UpdatePositionConditions({
                positionId: _positionId,
                trader: position.trader,
                closeConditions: _closeConditions
            });
        }
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IPositionManagerExtension).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @inheritdoc IPositionManagerExtension
     */
    function getOracleTolerableLimit(address assetA, address assetB) public view override returns (uint256) {
        uint256 oracleTolerableLimit = oracleTolerableLimits[assetA][assetB];
        return oracleTolerableLimit > 0 ? oracleTolerableLimit : defaultOracleTolerableLimit;
    }

    /**
     * @notice Opens a new position.
     * @param _position The position data.
     * @param _vars The variables for opening the position.
     * @return posEventData The event data for the opened position.
     */
    function _openPosition(
        PositionLibrary.Position memory _position,
        PositionLibrary.OpenPositionVars memory _vars,
        uint256 _initialGasLeft
    ) internal returns (PositionLibrary.OpenPositionEventData memory) {
        (
            PositionLibrary.Position memory position,
            PositionLibrary.OpenPositionEventData memory posEventData
        ) = PositionLibrary.openPosition(
                _position,
                _vars,
                PositionLibrary.PositionManagerParams({
                    primexDNS: primexDNS,
                    priceOracle: priceOracle,
                    traderBalanceVault: traderBalanceVault,
                    oracleTolerableLimitForThirdAsset: _vars.isThirdAsset
                        ? getOracleTolerableLimit(_vars.depositData.depositAsset, _position.positionAsset)
                        : 0,
                    oracleTolerableLimit: _vars.needOracleTolerableLimitCheck
                        ? getOracleTolerableLimit(_position.soldAsset, _position.positionAsset)
                        : 0,
                    maxPositionSize: maxPositionSize[_position.soldAsset][_position.positionAsset],
                    initialGasLeft: _initialGasLeft,
                    keeperRewardDistributor: address(keeperRewardDistributor)
                })
            );

        // create position and update indexes (by trader, by bucket)
        position.id = positionsId;
        positionsId++;

        positions.push(position);
        positionIndexes[position.id] = positions.length - 1;

        traderPositionIds[position.trader].push(position.id);
        traderPositionIndexes[position.id] = traderPositionIds[position.trader].length - 1;

        bucketPositionIds[address(position.bucket)].push(position.id);
        bucketPositionIndexes[position.id] = bucketPositionIds[address(position.bucket)].length - 1;

        position.setCloseConditions(closeConditions, _vars.closeConditions, primexDNS);

        // tracks spot trading activity.
        if (
            position.bucket == IBucketV3(address(0)) &&
            spotTradingRewardDistributor != ISpotTradingRewardDistributorV2(address(0))
        ) {
            spotTradingRewardDistributor.updateTraderActivity(
                _position.trader,
                position.positionAsset,
                position.positionAmount,
                _vars.positionUsdOracleData
            );
        }
        return posEventData;
    }

    /**
     * @dev Modifier to check if the sender is not blacklisted.
     */
    function _notBlackListed() internal view {
        _require(!whiteBlackList.isBlackListed(msg.sender), Errors.SENDER_IS_BLACKLISTED.selector);
    }

    /**
     * @dev Modifier to check if a position exists.
     * @param _id The ID of the position to check.
     */
    function _onlyExist(uint256 _id) internal view {
        _require(
            positions.length > 0 && _id == positions[positionIndexes[_id]].id,
            Errors.POSITION_DOES_NOT_EXIST.selector
        );
    }
}
