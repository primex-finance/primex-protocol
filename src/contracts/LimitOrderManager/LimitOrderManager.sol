// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "./LimitOrderManagerStorage.sol";
import {BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, NATIVE_CURRENCY, BIG_TIMELOCK_ADMIN} from "../Constants.sol";
import {ILimitOrderManager, ILimitOrderManagerV2} from "./ILimitOrderManager.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNSStorage.sol";
import {IPausable} from "../interfaces/IPausable.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";

contract LimitOrderManager is ILimitOrderManagerV2, LimitOrderManagerStorage {
    using WadRayMath for uint256;
    using LimitOrderLibrary for LimitOrderLibrary.LimitOrder;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if order doesn't exist
     * @param _orderId order id
     */
    modifier orderExists(uint256 _orderId) {
        uint256 index = orderIndexes[_orderId]; // is 0 if not explicitly set
        _require(orders.length > 0 && orders[index].id == _orderId, Errors.ORDER_DOES_NOT_EXIST.selector);
        _;
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(registry.hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
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
     * @inheritdoc ILimitOrderManager
     */
    function initialize(
        address _registry,
        address _primexDNS,
        address _pm,
        address payable _traderBalanceVault,
        address _swapManager,
        address _whiteBlackList
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165Upgradeable(_pm).supportsInterface(type(IPositionManagerV2).interfaceId) &&
                IERC165Upgradeable(_traderBalanceVault).supportsInterface(type(ITraderBalanceVault).interfaceId) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = IAccessControl(_registry);
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        primexDNS = IPrimexDNSV3(_primexDNS);
        pm = IPositionManagerV2(_pm);
        traderBalanceVault = ITraderBalanceVault(_traderBalanceVault);
        _setSwapManager(_swapManager);
        __Pausable_init();
        __ReentrancyGuard_init();
        __ERC165_init();
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function createLimitOrder(
        LimitOrderLibrary.CreateLimitOrderParams calldata _params
    ) external payable override nonReentrant notBlackListed whenNotPaused {
        pm.priceOracle().updatePullOracle{value: msg.value}(_params.pullOracleData, _params.pullOracleTypes);
        LimitOrderLibrary.LimitOrder memory order = LimitOrderLibrary.createLimitOrder(
            _params,
            pm,
            traderBalanceVault,
            primexDNS
        );
        ordersId++;
        order.id = ordersId;

        orders.push(order);
        orderIndexes[order.id] = orders.length - 1;

        traderOrderIds[order.trader].push(order.id);
        traderOrderIndexes[order.id] = traderOrderIds[order.trader].length - 1;

        bucketOrderIds[address(order.bucket)].push(order.id);
        bucketOrderIndexes[order.id] = bucketOrderIds[address(order.bucket)].length - 1;

        order.setCloseConditions(closeConditions, _params.closeConditions, primexDNS);
        order.setOpenConditions(openConditions, _params.openConditions, primexDNS);

        bool isSpot = bytes(_params.bucket).length == 0;
        LimitOrderType limitOrderType;
        if (isSpot) {
            limitOrderType = order.shouldOpenPosition ? LimitOrderType.Spot : LimitOrderType.Swap;
        }

        emit CreateLimitOrder({
            orderId: order.id,
            trader: order.trader,
            order: order,
            openConditions: openConditions[ordersId],
            closeConditions: closeConditions[ordersId]
        });
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function cancelLimitOrder(uint256 _orderId) external override orderExists(_orderId) nonReentrant notBlackListed {
        LimitOrderLibrary.LimitOrder storage order = orders[orderIndexes[_orderId]];
        _require(msg.sender == order.trader, Errors.CALLER_IS_NOT_TRADER.selector);

        bool isSpot = order.bucket == IBucketV3(address(0));
        emit CloseLimitOrder({
            orderId: _orderId,
            trader: order.trader,
            closedBy: msg.sender,
            reason: LimitOrderLibrary.CloseReason.Cancelled,
            positionId: 0,
            bucket: isSpot ? "" : order.bucket.name(),
            borrowedAsset: isSpot ? address(0) : address(order.bucket.borrowedAsset()),
            positionAsset: order.positionAsset,
            leverage: order.leverage,
            depositAsset: order.depositAsset,
            depositAmount: order.depositAmount
        });
        _unlockAssetsAndDeleteOrder(order);
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function cancelExpiredLimitOrders(uint256[] calldata _orderIds) external override {
        for (uint256 i; i < _orderIds.length; i++) {
            uint256 index = orderIndexes[_orderIds[i]];
            if (orders.length == 0) break;
            LimitOrderLibrary.LimitOrder storage order = orders[index];
            bool isSpot = order.bucket == IBucketV3(address(0));
            if (
                order.id == _orderIds[i] &&
                (order.deadline <= block.timestamp || (!isSpot && order.bucket.isWithdrawAfterDelistingAvailable()))
            ) {
                emit CloseLimitOrder({
                    orderId: order.id,
                    trader: order.trader,
                    closedBy: msg.sender,
                    reason: LimitOrderLibrary.CloseReason.Cancelled,
                    positionId: 0,
                    bucket: isSpot ? "" : order.bucket.name(),
                    borrowedAsset: isSpot ? address(0) : address(order.bucket.borrowedAsset()),
                    positionAsset: order.positionAsset,
                    leverage: order.leverage,
                    depositAsset: order.depositAsset,
                    depositAmount: order.depositAmount
                });
                _unlockAssetsAndDeleteOrder(order);
            }
        }
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function openPositionByOrder(
        LimitOrderLibrary.OpenPositionParams calldata _params
    ) external payable override orderExists(_params.orderId) nonReentrant notBlackListed whenNotPaused {
        uint256 initialGasleft = gasleft();
        pm.priceOracle().updatePullOracle{value: msg.value}(_params.pullOracleData, _params.pullOracleTypes);
        _require(
            _params.conditionIndex < openConditions[_params.orderId].length,
            Errors.CONDITION_INDEX_IS_OUT_OF_BOUNDS.selector
        );

        LimitOrderLibrary.LimitOrder storage order = orders[orderIndexes[_params.orderId]];

        _require(order.deadline > block.timestamp, Errors.ORDER_HAS_EXPIRED.selector);

        if (address(order.bucket) != address(0)) {
            _require(order.bucket.isActive(), Errors.BUCKET_IS_NOT_ACTIVE.selector);
            (, bool isSupported) = order.bucket.allowedAssets(order.positionAsset);
            _require(isSupported, Errors.ASSET_IS_NOT_SUPPORTED.selector);
        } else {
            _require(_params.borrowedAmount == 0, Errors.INCORRECT_BORROWED_AMOUNT.selector);
        }
        _require(_params.keeper != address(0), Errors.ADDRESS_IS_ZERO.selector);

        LimitOrderLibrary.OpenPositionByOrderVars memory vars = LimitOrderLibrary.openPositionByOrder(
            order,
            _params,
            closeConditions[order.id],
            pm,
            traderBalanceVault,
            swapManager,
            initialGasleft
        );

        LimitOrderLibrary.Condition storage condition = openConditions[_params.orderId][_params.conditionIndex];
        _require(
            IConditionalOpeningManager(primexDNS.cmTypeToAddress(condition.managerType)).canBeFilledAfterSwap(
                orders[orderIndexes[_params.orderId]],
                condition.params,
                _params.comAdditionalParams,
                vars.exchangeRate
            ),
            Errors.ORDER_CAN_NOT_BE_FILLED.selector
        );

        bool isSpot = order.bucket == IBucketV3(address(0));
        emit CloseLimitOrder({
            orderId: _params.orderId,
            trader: order.trader,
            closedBy: _params.keeper,
            reason: vars.closeReason,
            positionId: vars.newPositionId,
            bucket: isSpot ? "" : order.bucket.name(),
            borrowedAsset: isSpot ? address(0) : vars.assetIn,
            positionAsset: order.positionAsset,
            leverage: order.leverage,
            depositAsset: order.depositAsset,
            depositAmount: order.depositAmount
        });
        bool shouldUpdateReward = order.updatedConditionsAt != block.timestamp;
        _deleteOrder(order);
        if (shouldUpdateReward) {
            // to avoid abuse of the reward system, we will not pay the reward to
            // the keeper if the position open in the same block as the open conditions change
            pm.keeperRewardDistributor().updateReward(
                IKeeperRewardDistributorV3.UpdateRewardParams({
                    keeper: _params.keeper,
                    positionAsset: vars.assetOut,
                    positionSize: vars.amountOut + vars.feeInPositionAsset,
                    action: IKeeperRewardDistributorStorage.KeeperActionType.OpenByOrder,
                    numberOfActions: 1,
                    gasSpent: initialGasleft - gasleft(),
                    decreasingCounter: new uint256[](0),
                    routesLength: abi
                        .encode(_params.firstAssetMegaRoutes, _params.depositInThirdAssetMegaRoutes)
                        .length,
                    nativePmxOracleData: _params.nativePmxOracleData,
                    positionNativeAssetOracleData: _params.positionNativeAssetOracleData
                })
            );
        }
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function updateOrder(
        LimitOrderLibrary.UpdateLimitOrderParams calldata _params
    ) external payable override nonReentrant notBlackListed {
        LimitOrderLibrary.LimitOrder storage order = orders[orderIndexes[_params.orderId]];
        IBucketV3 bucket = order.bucket;

        _require(msg.sender == order.trader, Errors.CALLER_IS_NOT_TRADER.selector);

        if (bucket != IBucketV3(address(0))) {
            _require(bucket.isActive(), Errors.BUCKET_IS_NOT_ACTIVE.selector);
        }

        IPriceOracleV2 priceOracle = pm.priceOracle();

        priceOracle.updatePullOracle{value: msg.value}(_params.pullOracleData, _params.pullOracleTypes);

        if (_params.depositAmount != order.depositAmount) {
            order.updateDeposit(_params.depositAmount, _params.takeDepositFromWallet, traderBalanceVault);
        }
        if (_params.leverage != order.leverage) {
            order.updateLeverage(_params.leverage, primexDNS);
        }
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
        }
        order.feeToken = _params.isProtocolFeeInPmx ? primexDNS.pmx() : order.positionAsset;

        uint256 positionSize = order.depositAmount.wmul(order.leverage);
        IPrimexDNSStorageV3.TradingOrderType tradingOrderType;
        // isSwap = address(order.bucket) == address(0)
        if (address(order.bucket) == address(0)) {
            tradingOrderType = order.shouldOpenPosition
                ? IPrimexDNSStorageV3.TradingOrderType.SpotLimitOrder
                : IPrimexDNSStorageV3.TradingOrderType.SwapLimitOrder;
        } else {
            // isThirdAsset = order.depositAsset != address(bucket.borrowedAsset()) && order.depositAsset != order.positionAsset;
            tradingOrderType = order.depositAsset != address(bucket.borrowedAsset()) &&
                order.depositAsset != order.positionAsset
                ? IPrimexDNSStorageV3.TradingOrderType.MarginLimitOrderDepositInThirdAsset
                : IPrimexDNSStorageV3.TradingOrderType.MarginLimitOrder;
        }
        PrimexPricingLibrary.validateMinPositionSize(
            positionSize,
            order.depositAsset,
            address(priceOracle),
            pm.keeperRewardDistributor(),
            primexDNS,
            tradingOrderType,
            _params.nativeDepositOracleData
        );
        emit UpdateOrder({
            orderId: order.id,
            trader: order.trader,
            depositAmount: order.depositAmount,
            leverage: order.leverage,
            feeToken: order.feeToken
        });
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function updateOrderConditions(
        UpdateOrderConditionsParams memory _params
    ) external override nonReentrant notBlackListed {
        LimitOrderLibrary.LimitOrder storage order = orders[orderIndexes[_params.orderId]];
        _require(msg.sender == order.trader, Errors.CALLER_IS_NOT_TRADER.selector);
        if (order.bucket != IBucketV3(address(0))) {
            _require(order.bucket.isActive(), Errors.BUCKET_IS_NOT_ACTIVE.selector);
        }
        if (keccak256(abi.encode(_params.closeConditions)) != keccak256(abi.encode(closeConditions[order.id]))) {
            order.setCloseConditions(closeConditions, _params.closeConditions, primexDNS);
        }

        if (keccak256(abi.encode(_params.openConditions)) != keccak256(abi.encode(openConditions[order.id]))) {
            order.setOpenConditions(openConditions, _params.openConditions, primexDNS);
            order.updatedConditionsAt = block.timestamp;
        }
        emit UpdateOrderConditions({
            orderId: _params.orderId,
            trader: order.trader,
            openConditions: _params.openConditions,
            closeConditions: _params.closeConditions
        });
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function setSwapManager(address _swapManager) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _setSwapManager(_swapManager);
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
     * @inheritdoc ILimitOrderManager
     */
    function getOrder(uint256 _id) external view override returns (LimitOrderLibrary.LimitOrder memory) {
        _require(orders[orderIndexes[_id]].id == _id, Errors.ORDER_DOES_NOT_EXIST.selector);
        return orders[orderIndexes[_id]];
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getOrderByIndex(uint256 _index) external view override returns (LimitOrderLibrary.LimitOrder memory) {
        return orders[_index];
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getTraderOrdersLength(address _trader) external view override returns (uint256) {
        return traderOrderIds[_trader].length;
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getTraderOrders(address _trader) external view override returns (LimitOrderLibrary.LimitOrder[] memory) {
        uint256 ordersCount = traderOrderIds[_trader].length;
        LimitOrderLibrary.LimitOrder[] memory traderOrders = new LimitOrderLibrary.LimitOrder[](ordersCount);
        for (uint256 i; i < ordersCount; i++) {
            uint256 id = traderOrderIds[_trader][i];
            traderOrders[i] = orders[orderIndexes[id]];
        }
        return traderOrders;
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getBucketOrdersLength(address _bucket) external view override returns (uint256) {
        return bucketOrderIds[_bucket].length;
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getBucketOrders(address _bucket) external view override returns (LimitOrderLibrary.LimitOrder[] memory) {
        uint256 ordersCount = bucketOrderIds[_bucket].length;
        LimitOrderLibrary.LimitOrder[] memory bucketOrders = new LimitOrderLibrary.LimitOrder[](ordersCount);
        for (uint256 i; i < ordersCount; i++) {
            uint256 id = bucketOrderIds[_bucket][i];
            bucketOrders[i] = orders[orderIndexes[id]];
        }
        return bucketOrders;
    }

    /**
     * @notice Returns orders array length.
     */
    function getOrdersLength() public view override returns (uint256) {
        return orders.length;
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getCloseConditions(uint256 _orderId) public view override returns (LimitOrderLibrary.Condition[] memory) {
        return closeConditions[_orderId];
    }

    /**
     * @inheritdoc ILimitOrderManager
     */
    function getOpenConditions(uint256 _orderId) public view override returns (LimitOrderLibrary.Condition[] memory) {
        return openConditions[_orderId];
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(ILimitOrderManager).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Internal function to set new swapManager.
     * @param _swapManager Address of the new swapManager.
     */
    function _setSwapManager(address _swapManager) internal {
        _require(
            IERC165Upgradeable(_swapManager).supportsInterface(type(ISwapManager).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        swapManager = ISwapManager(_swapManager);
        emit ChangeSwapManager(_swapManager);
    }

    /**
     * @notice Unlocks a deposit amount and a fee amount in the TraderBalanceVault and deletes the order
     * @param _order order to delete
     */
    function _unlockAssetsAndDeleteOrder(LimitOrderLibrary.LimitOrder memory _order) internal {
        //unlock deposit
        traderBalanceVault.unlockAsset(
            ITraderBalanceVault.UnlockAssetParams(
                _order.trader,
                _order.trader,
                _order.depositAsset,
                _order.depositAmount
            )
        );
        //unlock fee
        traderBalanceVault.unlockAsset(
            ITraderBalanceVault.UnlockAssetParams(_order.trader, _order.trader, _order.feeToken, _order.protocolFee)
        );
        _deleteOrder(_order);
    }

    /**
     * @notice Deletes the order from the orders array
     * @param _order order to delete
     */
    function _deleteOrder(LimitOrderLibrary.LimitOrder memory _order) internal {
        delete openConditions[_order.id];
        delete closeConditions[_order.id];

        uint256 lastBucketOrderId = bucketOrderIds[address(_order.bucket)][
            bucketOrderIds[address(_order.bucket)].length - 1
        ];
        bucketOrderIds[address(_order.bucket)][bucketOrderIndexes[_order.id]] = lastBucketOrderId;
        bucketOrderIndexes[lastBucketOrderId] = bucketOrderIndexes[_order.id];
        bucketOrderIds[address(_order.bucket)].pop();
        delete bucketOrderIndexes[_order.id];

        uint256 lastTraderOrderId = traderOrderIds[_order.trader][traderOrderIds[_order.trader].length - 1];
        traderOrderIds[_order.trader][traderOrderIndexes[_order.id]] = lastTraderOrderId;
        traderOrderIndexes[lastTraderOrderId] = traderOrderIndexes[_order.id];
        traderOrderIds[_order.trader].pop();
        delete traderOrderIndexes[_order.id];

        orders[orderIndexes[_order.id]] = orders[orders.length - 1];
        orderIndexes[orders[orders.length - 1].id] = orderIndexes[_order.id];
        orders.pop();
        delete orderIndexes[_order.id];
    }
}
