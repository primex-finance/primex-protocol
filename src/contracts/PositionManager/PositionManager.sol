// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";

import "../Constants.sol";
import "./PositionManagerStorage.sol";
import {IPositionManager} from "./IPositionManager.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {ISpotTradingRewardDistributor} from "../SpotTradingRewardDistributor/ISpotTradingRewardDistributor.sol";
import {IBucket} from "../Bucket/IBucket.sol";
import {IPausable} from "../interfaces/IPausable.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";

contract PositionManager is IPositionManager, PositionManagerStorage {
    using WadRayMath for uint256;
    using PositionLibrary for PositionLibrary.Position;

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IPositionManager
     */
    function initialize(
        address _registry,
        address _primexDNS,
        address payable _traderBalanceVault,
        address _priceOracle,
        address _keeperRewardDistributor,
        address _whiteBlackList
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_primexDNS).supportsInterface(type(IPrimexDNS).interfaceId) &&
                IERC165Upgradeable(_traderBalanceVault).supportsInterface(type(ITraderBalanceVault).interfaceId) &&
                IERC165Upgradeable(_priceOracle).supportsInterface(type(IPriceOracle).interfaceId) &&
                IERC165Upgradeable(_keeperRewardDistributor).supportsInterface(
                    type(IKeeperRewardDistributor).interfaceId
                ) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = IAccessControl(_registry);
        primexDNS = IPrimexDNS(_primexDNS);
        traderBalanceVault = ITraderBalanceVault(_traderBalanceVault);
        priceOracle = IPriceOracle(_priceOracle);
        keeperRewardDistributor = IKeeperRewardDistributor(_keeperRewardDistributor);
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        __Pausable_init();
        __ReentrancyGuard_init();
        __ERC165_init();
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setMaxPositionSize(
        address _token0,
        address _token1,
        uint256 _amountInToken0,
        uint256 _amountInToken1
    ) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        PositionLibrary.setMaxPositionSize(maxPositionSize, _token0, _token1, _amountInToken0, _amountInToken1);
        emit SetMaxPositionSize(_token0, _token1, _amountInToken0, _amountInToken1);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setDefaultOracleTolerableLimit(uint256 _percent) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        _require(_percent <= WadRayMath.WAD, Errors.INVALID_PERCENT_NUMBER.selector);
        defaultOracleTolerableLimit = _percent;
        emit SetDefaultOracleTolerableLimit(_percent);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function doTransferOut(address _token, address _to, uint256 _amount) external override {
        _onlyRole(BATCH_MANAGER_ROLE);
        TokenTransfersLibrary.doTransferOut(_token, _to, _amount);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setSecurityBuffer(uint256 _newSecurityBuffer) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        _require(_newSecurityBuffer < WadRayMath.WAD, Errors.INVALID_SECURITY_BUFFER.selector);
        securityBuffer = _newSecurityBuffer;
        emit SecurityBufferChanged(_newSecurityBuffer);
    }

    /**
     * @inheritdoc IPositionManager
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
     * @inheritdoc IPositionManager
     */
    function setOracleTolerableLimit(address _assetA, address _assetB, uint256 _percent) external override {
        _onlyRole(BIG_TIMELOCK_ADMIN);
        PositionLibrary.setOracleTolerableLimit(oracleTolerableLimits, _assetA, _assetB, _percent);
        emit SetOracleTolerableLimit(_assetA, _assetB, _percent);
    }

    /**
     * @inheritdoc IPositionManager
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
     * @inheritdoc IPositionManager
     */
    function setMinPositionSize(uint256 _minPositionSize, address _minPositionAsset) external override {
        _onlyRole(MEDIUM_TIMELOCK_ADMIN);
        minPositionSize = _minPositionSize;
        minPositionAsset = _minPositionAsset;
        emit MinPositionSizeAndAssetChanged(_minPositionSize, _minPositionAsset);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setKeeperRewardDistributor(IKeeperRewardDistributor _keeperRewardDistributor) external override {
        _onlyRole(BIG_TIMELOCK_ADMIN);
        _require(
            IERC165Upgradeable(address(_keeperRewardDistributor)).supportsInterface(
                type(IKeeperRewardDistributor).interfaceId
            ),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        keeperRewardDistributor = _keeperRewardDistributor;
        emit KeeperRewardDistributorChanged(address(_keeperRewardDistributor));
    }

    /**
     * @inheritdoc IPositionManager
     */
    function openPositionByOrder(
        LimitOrderLibrary.OpenPositionByOrderParams calldata _params
    ) external override whenNotPaused returns (uint256, uint256, uint256, uint256) {
        _onlyRole(LOM_ROLE);
        (PositionLibrary.Position memory newPosition, PositionLibrary.OpenPositionVars memory vars) = PositionLibrary
            .createPositionByOrder(_params, priceOracle);
        PositionLibrary.OpenPositionEventData memory posEventData = _openPosition(newPosition, vars);

        PositionLibrary.Position memory position = positions[positions.length - 1];

        _updateTraderActivity(_params.order.trader, position.positionAsset, position.positionAmount, position.bucket);

        emit OpenPosition({
            positionId: position.id,
            trader: _params.order.trader,
            openedBy: _params.sender,
            position: position,
            feeToken: _params.order.feeToken,
            protocolFee: posEventData.protocolFee,
            entryPrice: posEventData.entryPrice,
            leverage: posEventData.leverage,
            closeConditions: vars.closeConditions
        });
        return (
            vars.borrowedAmount + position.depositAmountInSoldAsset,
            position.positionAmount,
            position.id,
            posEventData.entryPrice
        );
    }

    /**
     * @inheritdoc IPositionManager
     */
    function openPosition(
        PositionLibrary.OpenPositionParams calldata _params
    ) external payable override nonReentrant whenNotPaused {
        _notBlackListed();
        (PositionLibrary.Position memory newPosition, PositionLibrary.OpenPositionVars memory vars) = PositionLibrary
            .createPosition(_params, primexDNS, priceOracle);
        PositionLibrary.OpenPositionEventData memory posEventData = _openPosition(newPosition, vars);

        PositionLibrary.Position memory position = positions[positions.length - 1];
        _updateTraderActivity(msg.sender, position.positionAsset, position.positionAmount, position.bucket);

        emit OpenPosition({
            positionId: position.id,
            trader: position.trader,
            openedBy: position.trader,
            position: position,
            feeToken: _params.isProtocolFeeInPmx ? primexDNS.pmx() : NATIVE_CURRENCY,
            protocolFee: posEventData.protocolFee,
            entryPrice: posEventData.entryPrice,
            leverage: posEventData.leverage,
            closeConditions: vars.closeConditions
        });
    }

    /**
     * @inheritdoc IPositionManager
     */
    function closePositionByCondition(
        uint256 _id,
        address _keeper,
        PrimexPricingLibrary.Route[] calldata _routes,
        uint256 _conditionIndex,
        bytes calldata _ccmAdditionalParams,
        PositionLibrary.CloseReason _closeReason
    ) external override nonReentrant {
        _require(_closeReason != PositionLibrary.CloseReason.CLOSE_BY_TRADER, Errors.FORBIDDEN.selector);
        _notBlackListed();
        uint256 initialGasleft = gasleft();
        LimitOrderLibrary.Condition memory condition;
        if (_conditionIndex < closeConditions[_id].length) condition = closeConditions[_id][_conditionIndex];
        _closePosition(_id, _keeper, _routes, 0, condition, _ccmAdditionalParams, _closeReason, initialGasleft);
    }

    /**
     * @inheritdoc IPositionManager
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
     * @inheritdoc IPositionManager
     */
    function increaseDeposit(
        uint256 _positionId,
        uint256 _amount,
        address _asset,
        bool _takeDepositFromWallet,
        PrimexPricingLibrary.Route[] calldata _routes,
        uint256 _amountOutMin
    ) external override nonReentrant {
        _notBlackListed();
        PositionLibrary.Position storage position = positions[positionIndexes[_positionId]];
        uint256 depositDelta = position.increaseDeposit(
            PositionLibrary.IncreaseDepositParams({
                amount: _amount,
                asset: _asset,
                takeDepositFromWallet: _takeDepositFromWallet,
                routes: _routes,
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
     * @inheritdoc IPositionManager
     */
    function decreaseDeposit(uint256 _positionId, uint256 _amount) external override nonReentrant whenNotPaused {
        _notBlackListed();
        PositionLibrary.Position storage position = positions[positionIndexes[_positionId]];
        position.decreaseDeposit(
            PositionLibrary.DecreaseDepositParams({
                amount: _amount,
                primexDNS: primexDNS,
                priceOracle: priceOracle,
                traderBalanceVault: traderBalanceVault,
                pairPriceDrop: priceOracle.getPairPriceDrop(position.positionAsset, position.soldAsset),
                securityBuffer: securityBuffer,
                oracleTolerableLimit: getOracleTolerableLimit(position.positionAsset, position.soldAsset),
                maintenanceBuffer: maintenanceBuffer
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
     * @inheritdoc IPositionManager
     */
    function partiallyClosePosition(
        uint256 _positionId,
        uint256 _amount,
        address _depositReceiver,
        PrimexPricingLibrary.Route[] calldata _routes,
        uint256 _amountOutMin
    ) external override nonReentrant {
        _notBlackListed();
        _onlyExist(_positionId);
        PositionLibrary.Position memory position = positions[positionIndexes[_positionId]];
        _require(msg.sender == position.trader, Errors.CALLER_IS_NOT_TRADER.selector);
        _require(_amount < position.positionAmount, Errors.AMOUNT_IS_MORE_THAN_POSITION_AMOUNT.selector);
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
                routes: _routes,
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
                needOracleTolerableLimitCheck: scaledParams.borrowedAmountIsNotZero
            }),
            PositionLibrary.CloseReason.CLOSE_BY_TRADER
        );
        position.positionAmount -= _amount;
        position.scaledDebtAmount -= scaledParams.scaledDebtAmount;
        position.depositAmountInSoldAsset -= scaledParams.depositDecrease;
        PrimexPricingLibrary.validateMinPositionSize(
            minPositionSize,
            minPositionAsset,
            position.positionAmount,
            position.positionAsset,
            address(priceOracle)
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
            amountOut: posEventData.amountOut
        });
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
     * @inheritdoc IPositionManager
     */
    function canBeClosed(
        uint256 _positionId,
        uint256 _conditionIndex,
        bytes calldata _additionalParams
    ) external override returns (bool) {
        _require(
            _conditionIndex < closeConditions[_positionId].length,
            Errors.CONDITION_INDEX_IS_OUT_OF_BOUNDS.selector
        );
        LimitOrderLibrary.Condition storage condition = closeConditions[_positionId][_conditionIndex];
        return
            IConditionalClosingManager(primexDNS.cmTypeToAddress(condition.managerType)).canBeClosedBeforeSwap(
                positions[positionIndexes[_positionId]],
                condition.params,
                _additionalParams
            );
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setSpotTradingRewardDistributor(address _spotTradingRewardDistributor) external override {
        _onlyRole(BIG_TIMELOCK_ADMIN);
        spotTradingRewardDistributor = ISpotTradingRewardDistributor(_spotTradingRewardDistributor);
    }

    /**
     * @inheritdoc IPositionManager
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
     * @inheritdoc IPositionManager
     */
    function getPosition(uint256 _id) external view override returns (PositionLibrary.Position memory) {
        _onlyExist(_id);
        return positions[positionIndexes[_id]];
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionByIndex(uint256 _index) external view override returns (PositionLibrary.Position memory) {
        return positions[_index];
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getAllPositionsLength() external view override returns (uint256) {
        return positions.length;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getTraderPositionsLength(address _trader) external view override returns (uint256) {
        return traderPositionIds[_trader].length;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getBucketPositionsLength(address _bucket) external view override returns (uint256) {
        return bucketPositionIds[_bucket].length;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionDebt(uint256 _id) external view override returns (uint256) {
        _onlyExist(_id);
        return positions[positionIndexes[_id]].getDebt();
    }

    /**
     * @inheritdoc IPositionManager
     */
    function isPositionRisky(uint256 _id) external view override returns (bool) {
        return healthPosition(_id) < WadRayMath.WAD;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function isDelistedPosition(uint256 _id) external view override returns (bool) {
        _onlyExist(_id);
        PositionLibrary.Position storage position = positions[positionIndexes[_id]];
        return position.bucket == IBucket(address(0)) ? false : position.bucket.isDelisted();
    }

    /**
     * @inheritdoc IPositionManager
     */
    function closePosition(
        uint256 _id,
        address _depositReceiver,
        PrimexPricingLibrary.Route[] calldata _routes,
        uint256 _amountOutMin
    ) public override nonReentrant {
        _notBlackListed();
        LimitOrderLibrary.Condition memory condition;
        _closePosition(
            _id,
            _depositReceiver,
            _routes,
            _amountOutMin,
            condition,
            bytes(""),
            PositionLibrary.CloseReason.CLOSE_BY_TRADER,
            0
        );
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getOracleTolerableLimit(address assetA, address assetB) public view override returns (uint256) {
        uint256 oracleTolerableLimit = oracleTolerableLimits[assetA][assetB];
        return oracleTolerableLimit > 0 ? oracleTolerableLimit : defaultOracleTolerableLimit;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function healthPosition(uint256 _id) public view override returns (uint256) {
        _onlyExist(_id);
        PositionLibrary.Position storage position = positions[positionIndexes[_id]];
        return
            position.health(
                priceOracle,
                priceOracle.getPairPriceDrop(position.positionAsset, position.soldAsset),
                securityBuffer,
                getOracleTolerableLimit(position.positionAsset, position.soldAsset)
            );
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getCloseCondition(
        uint256 _positionId,
        uint256 _index
    ) public view override returns (LimitOrderLibrary.Condition memory) {
        return closeConditions[_positionId][_index];
    }

    /**
     * @inheritdoc IPositionManager
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
        return _interfaceId == type(IPositionManager).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Opens a new position.
     * @param _position The position data.
     * @param _vars The variables for opening the position.
     * @return posEventData The event data for the opened position.
     */
    function _openPosition(
        PositionLibrary.Position memory _position,
        PositionLibrary.OpenPositionVars memory _vars
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
                    minPositionSize: minPositionSize,
                    minPositionAsset: minPositionAsset,
                    maxPositionSize: maxPositionSize[_position.soldAsset][_position.positionAsset]
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
        return posEventData;
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

    /**
     * @notice Close a position.
     * @param _id The ID of the position to be closed.
     * @param _depositReceiver The address to receive the deposit assets.
     * @param _routes The trading routes to be used for swapping assets.
     * @param _amountOutMin The minimum amount of output asset expected from the swaps.
     * @param closeCondition The condition that must be satisfied to close the position.
     * @param _ccmAdditionalParams Additional parameters for custom closing managers.
     * @param _closeReason The reason for closing the position.
     */
    function _closePosition(
        uint256 _id,
        address _depositReceiver,
        PrimexPricingLibrary.Route[] calldata _routes,
        uint256 _amountOutMin,
        LimitOrderLibrary.Condition memory closeCondition,
        bytes memory _ccmAdditionalParams,
        PositionLibrary.CloseReason _closeReason,
        uint256 _initialGasLeft
    ) internal {
        _onlyExist(_id);
        _require(_depositReceiver != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
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
            routes: _routes,
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
            needOracleTolerableLimitCheck: vars.needOracleTolerableLimitCheck
        });
        IKeeperRewardDistributorStorage.KeeperActionType actionType = vars
            .position
            .closePosition(_params, _closeReason)
            .actionType;

        _deletePosition(_id, address(vars.position.bucket), vars.position.trader);
        if (
            _closeReason != PositionLibrary.CloseReason.CLOSE_BY_TRADER &&
            vars.position.updatedConditionsAt != block.timestamp
        ) {
            // to avoid abuse of the reward system, we will not pay the reward to
            // the keeper if the position open in the same block as the open conditions change
            keeperRewardDistributor.updateReward(
                IKeeperRewardDistributor.UpdateRewardParams({
                    keeper: _depositReceiver,
                    positionAsset: vars.position.positionAsset,
                    positionSize: vars.position.positionAmount,
                    action: actionType,
                    numberOfActions: 1,
                    gasSpent: _initialGasLeft - gasleft(),
                    decreasingCounter: new uint256[](0),
                    routesLength: abi.encode(_routes).length
                })
            );
        }
    }

    /**
     * @notice Internal function to update trader activity.
     * @dev This function updates the activity of a trader by calling the `updateTraderActivity` function
     * @param trader The address of the trader whose activity is being updated.
     * @param positionAsset The address of the position asset.
     * @param positionSize The size of the position.
     * @param bucket The bucket for which the trader's activity is being updated.
     */
    function _updateTraderActivity(
        address trader,
        address positionAsset,
        uint256 positionSize,
        IBucket bucket
    ) internal {
        // Tracks only spot trading activity.
        if (
            bucket == IBucket(address(0)) && spotTradingRewardDistributor != ISpotTradingRewardDistributor(address(0))
        ) {
            spotTradingRewardDistributor.updateTraderActivity(trader, positionAsset, positionSize);
        }
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
