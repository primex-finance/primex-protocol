// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";

import "../Constants.sol";
import "./PositionManagerStorage.sol";
import {IPositionManagerV2} from "./IPositionManager.sol";
import {IPositionManagerExtension} from "./IPositionManagerExtension.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {IPriceOracleStorageV2} from "../PriceOracle/IPriceOracleStorage.sol";
import {ISpotTradingRewardDistributorV2} from "../SpotTradingRewardDistributor/ISpotTradingRewardDistributor.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPausable} from "../interfaces/IPausable.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";

contract PositionManager is IPositionManagerV2, PositionManagerStorageV2 {
    using WadRayMath for uint256;
    using PositionLibrary for PositionLibrary.Position;

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function initialize(
        address _registry,
        address _primexDNS,
        address payable _traderBalanceVault,
        address _priceOracle,
        address _keeperRewardDistributor,
        address _whiteBlackList,
        address _positionManagerExtension
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165Upgradeable(_traderBalanceVault).supportsInterface(type(ITraderBalanceVault).interfaceId) &&
                IERC165Upgradeable(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId) &&
                IERC165Upgradeable(_keeperRewardDistributor).supportsInterface(
                    type(IKeeperRewardDistributorV3).interfaceId
                ) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = IAccessControl(_registry);
        primexDNS = IPrimexDNSV3(_primexDNS);
        traderBalanceVault = ITraderBalanceVault(_traderBalanceVault);
        priceOracle = IPriceOracleV2(_priceOracle);
        keeperRewardDistributor = IKeeperRewardDistributorV3(_keeperRewardDistributor);
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        _setPositionManagerExtension(_positionManagerExtension);
        __Pausable_init();
        __ReentrancyGuard_init();
        __ERC165_init();
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function setPositionManagerExtension(address _newPositionManagerExtension) external override {
        _onlyRole(BIG_TIMELOCK_ADMIN);
        _setPositionManagerExtension(_newPositionManagerExtension);
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function setProtocolParamsByAdmin(bytes calldata _data) external override {
        Address.functionDelegateCall(positionManagerExtension, _data);
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function doTransferOut(address _token, address _to, uint256 _amount) external override {
        _onlyRole(BATCH_MANAGER_ROLE);
        TokenTransfersLibrary.doTransferOut(_token, _to, _amount);
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function openPositionByOrder(
        LimitOrderLibrary.OpenPositionByOrderParams calldata _params
    ) external override returns (uint256, uint256, uint256, uint256, uint256) {
        bytes memory data = abi.encodeWithSelector(IPositionManagerExtension.openPositionByOrder.selector, _params);
        bytes memory returnData = Address.functionDelegateCall(positionManagerExtension, data);
        return abi.decode(returnData, (uint256, uint256, uint256, uint256, uint256));
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function openPosition(PositionLibrary.OpenPositionParams calldata _params) external payable override {
        bytes memory data = abi.encodeWithSelector(IPositionManagerExtension.openPosition.selector, _params);
        Address.functionDelegateCall(positionManagerExtension, data);
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function closePositionByCondition(
        ClosePositionByConditionParams calldata _params
    ) external payable override nonReentrant {
        _require(_params.closeReason != PositionLibrary.CloseReason.CLOSE_BY_TRADER, Errors.FORBIDDEN.selector);
        _notBlackListed();
        uint256 initialGasleft = gasleft();
        LimitOrderLibrary.Condition memory condition;
        if (_params.conditionIndex < closeConditions[_params.id].length)
            condition = closeConditions[_params.id][_params.conditionIndex];
        PositionLibrary.ClosePositionEventData memory posEventData = _closePosition(
            _params.id,
            _params.keeper,
            _params.megaRoutes,
            0,
            condition,
            _params.ccmAdditionalParams,
            _params.closeReason,
            initialGasleft,
            _params.positionSoldAssetOracleData,
            _params.nativePmxOracleData,
            _params.pmxSoldAssetOracleData,
            _params.nativeSoldAssetOracleData,
            _params.positionNativeAssetOracleData,
            _params.pullOracleData,
            _params.pullOracleTypes
        );

        emit PositionLibrary.PaidProtocolFee({
            positionId: _params.id,
            trader: posEventData.trader,
            paymentAsset: posEventData.paymentAsset,
            feeRateType: posEventData.feeRateType,
            feeInPaymentAsset: posEventData.feeInPaymentAsset,
            feeInPmx: posEventData.feeInPmx
        });
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function updatePositionConditions(
        uint256 _positionId,
        LimitOrderLibrary.Condition[] calldata _closeConditions
    ) external override {
        bytes memory data = abi.encodeWithSelector(
            IPositionManagerExtension.updatePositionConditions.selector,
            _positionId,
            _closeConditions
        );
        Address.functionDelegateCall(positionManagerExtension, data);
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function increaseDeposit(
        uint256 _positionId,
        uint256 _amount,
        address _asset,
        bool _takeDepositFromWallet,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin
    ) external override nonReentrant {
        _notBlackListed();
        PositionLibrary.Position storage position = positions[positionIndexes[_positionId]];
        uint256 depositDelta = position.increaseDeposit(
            PositionLibrary.IncreaseDepositParams({
                amount: _amount,
                asset: _asset,
                takeDepositFromWallet: _takeDepositFromWallet,
                megaRoutes: _megaRoutes,
                primexDNS: primexDNS,
                priceOracle: priceOracle,
                traderBalanceVault: traderBalanceVault,
                amountOutMin: _amountOutMin
            })
        );

        emit IncreaseDeposit({
            positionId: position.id,
            trader: position.trader,
            depositDelta: depositDelta,
            scaledDebtAmount: position.scaledDebtAmount
        });
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function decreaseDeposit(
        uint256 _positionId,
        uint256 _amount,
        bytes calldata _positionSoldAssetOracleData,
        bytes calldata _nativeSoldAssetOracleData,
        bytes[][] calldata _pullOracleData,
        uint256[] calldata _pullOracleTypes
    ) external payable override {
        bytes memory data = abi.encodeWithSelector(
            IPositionManagerExtension.decreaseDeposit.selector,
            _positionId,
            _amount,
            _positionSoldAssetOracleData,
            _nativeSoldAssetOracleData,
            _pullOracleData,
            _pullOracleTypes
        );
        Address.functionDelegateCall(positionManagerExtension, data);
    }

    /**
     * @inheritdoc IPositionManagerV2
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
    ) external payable override {
        bytes memory data = abi.encodeWithSelector(
            IPositionManagerExtension.partiallyClosePosition.selector,
            _positionId,
            _amount,
            _depositReceiver,
            _megaRoutes,
            _amountOutMin,
            _positionSoldAssetOracleData,
            _nativePositionAssetOracleData,
            _nativeSoldAssetOracleData,
            _pmxSoldAssetOracleData,
            _pullOracleData,
            _pullOracleTypes
        );
        Address.functionDelegateCall(positionManagerExtension, data);
    }

    /**
     * @inheritdoc IPausable
     */
    function pause() external override {
        _onlyRole(EMERGENCY_ADMIN);
        _pause();
    }

    /**
     * @inheritdoc IPausable
     */
    function unpause() external override {
        _onlyRole(SMALL_TIMELOCK_ADMIN);
        _unpause();
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function deletePositions(
        uint256[] calldata _ids,
        address[] calldata _traders,
        uint256 _length,
        address _bucket
    ) external override {
        _onlyRole(BATCH_MANAGER_ROLE);
        for (uint256 i; i < _length; i++) {
            _onlyExist(_ids[i]);
            _deletePosition(_ids[i], _bucket, _traders[i]);
        }
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getPosition(uint256 _id) external view override returns (PositionLibrary.Position memory) {
        _onlyExist(_id);
        return positions[positionIndexes[_id]];
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getPositionByIndex(uint256 _index) external view override returns (PositionLibrary.Position memory) {
        return positions[_index];
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getAllPositionsLength() external view override returns (uint256) {
        return positions.length;
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getTraderPositionsLength(address _trader) external view override returns (uint256) {
        return traderPositionIds[_trader].length;
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getBucketPositionsLength(address _bucket) external view override returns (uint256) {
        return bucketPositionIds[_bucket].length;
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getPositionDebt(uint256 _id) external view override returns (uint256) {
        _onlyExist(_id);
        return positions[positionIndexes[_id]].getDebt();
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function isDelistedPosition(uint256 _id) external view override returns (bool) {
        _onlyExist(_id);
        PositionLibrary.Position storage position = positions[positionIndexes[_id]];
        return position.bucket == IBucketV3(address(0)) ? false : position.bucket.isDelisted();
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function closePosition(
        uint256 _id,
        address _depositReceiver,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin,
        bytes calldata _positionSoldAssetOracleData,
        bytes calldata _pmxSoldAssetOracleData,
        bytes calldata _nativeSoldAssetOracleData,
        bytes[][] calldata _pullOracleData,
        uint256[] calldata _pullOracleTypes
    ) public payable override nonReentrant {
        _notBlackListed();
        LimitOrderLibrary.Condition memory condition;
        PositionLibrary.ClosePositionEventData memory posEventData = _closePosition(
            _id,
            _depositReceiver,
            _megaRoutes,
            _amountOutMin,
            condition,
            new bytes(0),
            PositionLibrary.CloseReason.CLOSE_BY_TRADER,
            0,
            _positionSoldAssetOracleData,
            new bytes(0),
            _pmxSoldAssetOracleData,
            _nativeSoldAssetOracleData,
            new bytes(0),
            _pullOracleData,
            _pullOracleTypes
        );

        emit PositionLibrary.PaidProtocolFee({
            positionId: _id,
            trader: posEventData.trader,
            paymentAsset: posEventData.paymentAsset,
            feeRateType: posEventData.feeRateType,
            feeInPaymentAsset: posEventData.feeInPaymentAsset,
            feeInPmx: posEventData.feeInPmx
        });
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getOracleTolerableLimit(address assetA, address assetB) public view override returns (uint256) {
        uint256 oracleTolerableLimit = oracleTolerableLimits[assetA][assetB];
        return oracleTolerableLimit > 0 ? oracleTolerableLimit : defaultOracleTolerableLimit;
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getCloseCondition(
        uint256 _positionId,
        uint256 _index
    ) public view override returns (LimitOrderLibrary.Condition memory) {
        return closeConditions[_positionId][_index];
    }

    /**
     * @inheritdoc IPositionManagerV2
     */
    function getCloseConditions(
        uint256 _positionId
    ) public view override returns (LimitOrderLibrary.Condition[] memory) {
        return closeConditions[_positionId];
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IPositionManagerV2).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @dev delete position and update indexes (by trader, by bucket)
     * can be simplified with EnumerableMap by OpenZeppelin
     * @param _id the id of the position to be deleted
     * @param _bucket the bucket of the position to be deleted
     * @param _trader the trader of the position to be deleted
     */
    function _deletePosition(uint256 _id, address _bucket, address _trader) internal {
        delete closeConditions[_id];

        uint256 lastBucketPositionId = bucketPositionIds[_bucket][bucketPositionIds[_bucket].length - 1];
        bucketPositionIds[_bucket][bucketPositionIndexes[_id]] = lastBucketPositionId;
        bucketPositionIndexes[lastBucketPositionId] = bucketPositionIndexes[_id];
        bucketPositionIds[_bucket].pop();
        delete bucketPositionIndexes[_id];

        uint256 lastTraderPositionId = traderPositionIds[_trader][traderPositionIds[_trader].length - 1];
        traderPositionIds[_trader][traderPositionIndexes[_id]] = lastTraderPositionId;
        traderPositionIndexes[lastTraderPositionId] = traderPositionIndexes[_id];
        traderPositionIds[_trader].pop();
        delete traderPositionIndexes[_id];

        positions[positionIndexes[_id]] = positions[positions.length - 1];
        positionIndexes[positions[positions.length - 1].id] = positionIndexes[_id];
        positions.pop();
        delete positionIndexes[_id];
    }

    function _setPositionManagerExtension(address _newPositionManagerExtension) internal {
        _require(
            IERC165Upgradeable(_newPositionManagerExtension).supportsInterface(
                type(IPositionManagerExtension).interfaceId
            ),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        positionManagerExtension = _newPositionManagerExtension;
        emit ChangePositionManagerExtension(_newPositionManagerExtension);
    }

    /**
     * @notice Close a position.
     * @param _id The ID of the position to be closed.
     * @param _depositReceiver The address to receive the deposit assets.
     * @param _megaRoutes The trading routes to be used for swapping assets.
     * @param _amountOutMin The minimum amount of output asset expected from the swaps.
     * @param closeCondition The condition that must be satisfied to close the position.
     * @param _ccmAdditionalParams Additional parameters for custom closing managers.
     * @param _closeReason The reason for closing the position.
     */
    function _closePosition(
        uint256 _id,
        address _depositReceiver,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin,
        LimitOrderLibrary.Condition memory closeCondition,
        bytes memory _ccmAdditionalParams,
        PositionLibrary.CloseReason _closeReason,
        uint256 _initialGasLeft,
        bytes calldata _positionSoldAssetOracleData,
        bytes memory _nativePmxOracleData,
        bytes calldata _pmxSoldAssetOracleData,
        bytes calldata _nativeSoldAssetOracleData,
        bytes memory _positionNativeAssetOracleData,
        bytes[][] calldata _pullOracleData,
        uint256[] calldata _pullOracleTypes
    ) internal returns (PositionLibrary.ClosePositionEventData memory) {
        _onlyExist(_id);
        _require(_depositReceiver != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        priceOracle.updatePullOracle{value: msg.value}(_pullOracleData, _pullOracleTypes);
        ClosePositionVars memory vars;
        vars.position = positions[positionIndexes[_id]];
        vars.borrowedAmountIsNotZero = vars.position.scaledDebtAmount > 0;
        // we don't check limit when the close reason is CLOSE_BY_TRADER AND a position is spot
        vars.needOracleTolerableLimitCheck =
            _closeReason != PositionLibrary.CloseReason.CLOSE_BY_TRADER ||
            vars.borrowedAmountIsNotZero;

        if (vars.needOracleTolerableLimitCheck) {
            vars.oracleTolerableLimit = getOracleTolerableLimit(vars.position.positionAsset, vars.position.soldAsset);
            if (registry.hasRole(TRUSTED_TOLERABLE_LIMIT_ROLE, msg.sender)) {
                vars.oracleTolerableLimit = vars.oracleTolerableLimit.wmul(oracleTolerableLimitMultiplier);
            }
        }
        PositionLibrary.ClosePositionParams memory _params = PositionLibrary.ClosePositionParams({
            closeAmount: vars.position.positionAmount,
            depositDecrease: vars.position.depositAmountInSoldAsset,
            scaledDebtAmount: vars.position.scaledDebtAmount,
            depositReceiver: _depositReceiver,
            megaRoutes: _megaRoutes,
            amountOutMin: _amountOutMin,
            oracleTolerableLimit: vars.oracleTolerableLimit,
            primexDNS: primexDNS,
            priceOracle: priceOracle,
            traderBalanceVault: traderBalanceVault,
            closeCondition: closeCondition,
            ccmAdditionalParams: _ccmAdditionalParams,
            borrowedAmountIsNotZero: vars.borrowedAmountIsNotZero,
            pairPriceDrop: priceOracle.getPairPriceDrop(vars.position.positionAsset, vars.position.soldAsset),
            securityBuffer: securityBuffer,
            needOracleTolerableLimitCheck: vars.needOracleTolerableLimitCheck,
            initialGasLeft: _initialGasLeft,
            keeperRewardDistributor: address(keeperRewardDistributor),
            positionSoldAssetOracleData: _positionSoldAssetOracleData,
            pmxSoldAssetOracleData: _pmxSoldAssetOracleData,
            nativeSoldAssetOracleData: _nativeSoldAssetOracleData
        });
        PositionLibrary.ClosePositionEventData memory posEventData = vars.position.closePosition(_params, _closeReason);

        _deletePosition(_id, address(vars.position.bucket), vars.position.trader);
        if (
            _closeReason != PositionLibrary.CloseReason.CLOSE_BY_TRADER &&
            vars.position.updatedConditionsAt != block.timestamp
        ) {
            // to avoid abuse of the reward system, we will not pay the reward to
            // the keeper if the position open in the same block as the open conditions change
            keeperRewardDistributor.updateReward(
                IKeeperRewardDistributorV3.UpdateRewardParams({
                    keeper: _depositReceiver,
                    positionAsset: vars.position.positionAsset,
                    positionSize: vars.position.positionAmount,
                    action: posEventData.actionType,
                    numberOfActions: 1,
                    gasSpent: _initialGasLeft - gasleft(),
                    decreasingCounter: new uint256[](0),
                    routesLength: abi.encode(_megaRoutes).length,
                    nativePmxOracleData: _nativePmxOracleData,
                    positionNativeAssetOracleData: _positionNativeAssetOracleData
                })
            );
        }
        return posEventData;
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    function _onlyRole(bytes32 _role) internal view {
        _require(registry.hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
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
