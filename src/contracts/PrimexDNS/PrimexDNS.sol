// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import "../libraries/Errors.sol";

import "./PrimexDNSStorage.sol";
import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN} from "../Constants.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IPrimexDNSV3} from "./IPrimexDNS.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";
import {ILiquidityMiningRewardDistributor} from "../LiquidityMiningRewardDistributor/ILiquidityMiningRewardDistributor.sol";
import {ITreasury} from "../Treasury/ITreasury.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {IConditionalOpeningManager} from "../interfaces/IConditionalOpeningManager.sol";

contract PrimexDNS is IPrimexDNSV3, PrimexDNSStorageV3 {
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function initialize(InitParams calldata _params) public override initializer {
        _require(
            IERC165Upgradeable(_params.pmx).supportsInterface(type(IERC20).interfaceId) &&
                IERC165Upgradeable(_params.registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_params.treasury).supportsInterface(type(ITreasury).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        _setMaxProtocolFee(_params.maxProtocolFee);
        _setLiquidationGasAmount(_params.liquidationGasAmount);
        _setProtocolFeeCoefficient(_params.protocolFeeCoefficient);
        _setAdditionalGasSpent(_params.additionalGasSpent);
        _setPmxDiscountMultiplier(_params.pmxDiscountMultiplier);
        _setGasPriceBuffer(_params.gasPriceBuffer);

        for (uint256 i; i < _params.feeRateParams.length; i++) {
            _setProtocolFeeRate(_params.feeRateParams[i]);
        }

        for (uint256 i; i < _params.averageGasPerActionParams.length; i++) {
            _setAverageGasPerAction(_params.averageGasPerActionParams[i]);
        }

        pmx = _params.pmx;
        registry = _params.registry;
        treasury = _params.treasury;
        delistingDelay = _params.delistingDelay;
        adminWithdrawalDelay = _params.adminWithdrawalDelay;
        __ERC165_init();
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setConditionalManager(uint256 _cmType, address _address) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165Upgradeable(_address).supportsInterface(type(IConditionalOpeningManager).interfaceId) ||
                IERC165Upgradeable(_address).supportsInterface(type(IConditionalClosingManager).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        cmTypeToAddress[_cmType] = _address;
        emit ConditionalManagerChanged(_cmType, _address);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setPMX(address _pmx) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165Upgradeable(_pmx).supportsInterface(type(IERC20).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        pmx = _pmx;
        emit PMXchanged(_pmx);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setAavePool(address _aavePool) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        aavePool = _aavePool;
        emit AavePoolChanged(_aavePool);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setMaxProtocolFee(uint256 _maxProtocolFee) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _setMaxProtocolFee(_maxProtocolFee);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setMinFeeRestrictions(
        CallingMethod _callingMethod,
        MinFeeRestrictions calldata _minFeeRestrictions
    ) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        minFeeRestrictions[_callingMethod] = _minFeeRestrictions;
        emit ChangeMinFeeRestrictions(_callingMethod, _minFeeRestrictions);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setLiquidationGasAmount(uint256 _liquidationGasAmount) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _setLiquidationGasAmount(_liquidationGasAmount);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setProtocolFeeRate(FeeRateParams calldata _feeRateParams) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _setProtocolFeeRate(_feeRateParams);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setAverageGasPerAction(
        AverageGasPerActionParams calldata _averageGasPerActionParams
    ) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _setAverageGasPerAction(_averageGasPerActionParams);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setProtocolFeeCoefficient(uint256 _protocolFeeCoefficient) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _setProtocolFeeCoefficient(_protocolFeeCoefficient);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setAdditionalGasSpent(uint256 _additionalGasSpent) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _setAdditionalGasSpent(_additionalGasSpent);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setPmxDiscountMultiplier(uint256 _pmxDiscountMultiplier) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _setPmxDiscountMultiplier(_pmxDiscountMultiplier);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setGasPriceBuffer(uint256 _gasPriceBuffer) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _setGasPriceBuffer(_gasPriceBuffer);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function getPrimexDNSParams(
        FeeRateType _feeRateType
    ) external view override returns (address, address, uint256, uint256, uint256) {
        return (pmx, treasury, protocolFeeRates[_feeRateType], maxProtocolFee, pmxDiscountMultiplier);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function getParamsForMinProtocolFee(
        CallingMethod _callingMethod
    ) external view override returns (uint256, uint256, uint256, uint256, uint256) {
        MinFeeRestrictions memory restrictions = minFeeRestrictions[_callingMethod];
        return (
            liquidationGasAmount,
            protocolFeeCoefficient,
            additionalGasSpent,
            restrictions.maxGasAmount,
            restrictions.baseLength
        );
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function getArbitrumBaseLengthForTradingOrderType(
        TradingOrderType _tradingOrderType
    ) external view override returns (uint256) {
        if (
            _tradingOrderType == TradingOrderType.MarginMarketOrder ||
            _tradingOrderType == TradingOrderType.SpotMarketOrder
        ) {
            return minFeeRestrictions[CallingMethod.ClosePositionByCondition].baseLength;
        } else if (_tradingOrderType == TradingOrderType.SwapLimitOrder) {
            return minFeeRestrictions[CallingMethod.OpenPositionByOrder].baseLength;
        } else {
            return
                minFeeRestrictions[CallingMethod.OpenPositionByOrder].baseLength +
                minFeeRestrictions[CallingMethod.ClosePositionByCondition].baseLength;
        }
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function deprecateBucket(string memory _bucket) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        BucketData storage bucket = buckets[_bucket];
        _require(bucket.currentStatus != Status.Deprecated, Errors.BUCKET_IS_ALREADY_DEPRECATED.selector);
        bucket.currentStatus = Status.Deprecated;
        uint256 delistingDeadline = block.timestamp + delistingDelay;
        bucket.delistingDeadline = delistingDeadline;
        bucket.adminDeadline = delistingDeadline + adminWithdrawalDelay;
        emit BucketDeprecated(bucket.bucketAddress, delistingDeadline);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function activateBucket(string memory _bucket) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        BucketData storage bucket = buckets[_bucket];
        _require(bucket.currentStatus == Status.Inactive, Errors.BUCKET_ALREADY_ACTIVATED.selector);
        _require(bucket.bucketAddress != address(0), Errors.BUCKET_NOT_ADDED.selector);
        bucket.currentStatus = Status.Active;
        emit BucketActivated(bucket.bucketAddress);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function freezeBucket(string memory _bucket) external override onlyRole(EMERGENCY_ADMIN) {
        _require(buckets[_bucket].currentStatus == Status.Active, Errors.BUCKET_ALREADY_FROZEN.selector);
        buckets[_bucket].currentStatus = Status.Inactive;
        emit BucketFrozen(buckets[_bucket].bucketAddress);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function addBucket(address _newBucket, uint256 _pmxRewardAmount) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _require(
            IERC165Upgradeable(_newBucket).supportsInterface(type(IBucketV3).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        string memory name = IBucketV3(_newBucket).name();
        _require(buckets[name].bucketAddress == address(0), Errors.BUCKET_IS_ALREADY_ADDED.selector);

        IBucketV3.LiquidityMiningParams memory params = IBucketV3(_newBucket).getLiquidityMiningParams();
        if (params.accumulatingAmount != 0) {
            // can be changed on transferAsset in traderBalanceVault to moving untransferable token
            IERC20(pmx).transferFrom(msg.sender, address(params.liquidityMiningRewardDistributor), _pmxRewardAmount);
            params.liquidityMiningRewardDistributor.updateBucketReward(name, _pmxRewardAmount);
        }

        BucketData memory newBucket = BucketData(_newBucket, Status.Active, 0, 0);
        buckets[name] = newBucket;
        emit AddNewBucket(newBucket);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function activateDEX(string memory _dex) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(!dexes[_dex].isActive, Errors.DEX_IS_ALREADY_ACTIVATED.selector);
        dexes[_dex].isActive = true;
        emit DexActivated(dexes[_dex].routerAddress);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function freezeDEX(string memory _dex) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(dexes[_dex].isActive, Errors.DEX_IS_ALREADY_FROZEN.selector);
        dexes[_dex].isActive = false;
        emit DexFrozen(dexes[_dex].routerAddress);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function addDEX(string memory _name, address _routerAddress) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(dexes[_name].routerAddress == address(0), Errors.DEX_IS_ALREADY_ADDED.selector);
        _require(_routerAddress != address(0), Errors.CAN_NOT_ADD_WITH_ZERO_ADDRESS.selector);
        dexesNames.push(_name);
        DexData memory newDEX = DexData(_routerAddress, true);
        dexes[_name] = newDEX;
        emit AddNewDex(newDEX);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function setDexAdapter(address _newAdapterAddress) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165Upgradeable(_newAdapterAddress).supportsInterface(type(IDexAdapter).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        dexAdapter = _newAdapterAddress;
        emit DexAdapterChanged(_newAdapterAddress);
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function getAllDexes() external view override returns (string[] memory) {
        return dexesNames;
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function getBucketAddress(string memory _name) external view override returns (address) {
        BucketData memory bucket = buckets[_name];
        _require(bucket.bucketAddress != address(0), Errors.BUCKET_NOT_ADDED.selector);
        _require(bucket.currentStatus == Status.Active, Errors.BUCKET_IS_INACTIVE.selector);
        return bucket.bucketAddress;
    }

    /**
     * @inheritdoc IPrimexDNSV3
     */
    function getDexAddress(string memory _name) external view override returns (address) {
        DexData memory dex = dexes[_name];
        _require(dex.routerAddress != address(0), Errors.DEX_NOT_ADDED.selector);
        _require(dex.isActive, Errors.DEX_NOT_ACTIVE.selector);
        return dex.routerAddress;
    }

    /**
     * @notice Interface checker
     * @param interfaceId The interface id to check
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IPrimexDNSV3).interfaceId || super.supportsInterface(interfaceId);
    }

    function _setMaxProtocolFee(uint256 _maxProtocolFee) internal {
        maxProtocolFee = _maxProtocolFee;
        emit ChangeMaxProtocolFee(_maxProtocolFee);
    }

    function _setLiquidationGasAmount(uint256 _liquidationGasAmount) internal {
        liquidationGasAmount = _liquidationGasAmount;
        emit ChangeLiquidationGasAmount(_liquidationGasAmount);
    }

    function _setProtocolFeeCoefficient(uint256 _protocolFeeCoefficient) internal {
        protocolFeeCoefficient = _protocolFeeCoefficient;
        emit ChangeProtocolFeeCoefficient(_protocolFeeCoefficient);
    }

    function _setProtocolFeeRate(FeeRateParams calldata _feeRateParams) internal {
        protocolFeeRates[_feeRateParams.feeRateType] = _feeRateParams.feeRate;
        emit ChangeProtocolFeeRate(_feeRateParams.feeRateType, _feeRateParams.feeRate);
    }

    function _setAverageGasPerAction(AverageGasPerActionParams calldata _averageGasPerActionParams) internal {
        averageGasPerAction[_averageGasPerActionParams.tradingOrderType] = _averageGasPerActionParams
            .averageGasPerAction;
        emit ChangeAverageGasPerAction(
            _averageGasPerActionParams.tradingOrderType,
            _averageGasPerActionParams.averageGasPerAction
        );
    }

    function _setAdditionalGasSpent(uint256 _additionalGasSpent) internal {
        additionalGasSpent = _additionalGasSpent;
        emit ChangeAdditionalGasSpent(_additionalGasSpent);
    }

    function _setPmxDiscountMultiplier(uint256 _pmxDiscountMultiplier) internal {
        pmxDiscountMultiplier = _pmxDiscountMultiplier;
        emit ChangePmxDiscountMultiplier(_pmxDiscountMultiplier);
    }

    function _setGasPriceBuffer(uint256 _gasPriceBuffer) internal {
        gasPriceBuffer = _gasPriceBuffer;
        emit ChangeGasPriceBuffer(_gasPriceBuffer);
    }
}
