// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPrimexDNSStorage, IPrimexDNSStorageV3} from "./IPrimexDNSStorage.sol";

interface IPrimexDNSV3 is IPrimexDNSStorageV3 {
    event AddNewBucket(BucketData newBucketData);
    event BucketDeprecated(address bucketAddress, uint256 delistingTime);
    event AddNewDex(DexData newDexData);
    event ConditionalManagerChanged(uint256 indexed cmType, address indexed cmAddress);
    event PMXchanged(address indexed pmx);
    event AavePoolChanged(address indexed aavePool);
    event BucketActivated(address indexed bucketAddress);
    event BucketFrozen(address indexed bucketAddress);
    event DexAdapterChanged(address indexed newAdapterAddress);
    event DexActivated(address indexed routerAddress);
    event DexFrozen(address indexed routerAddress);

    event ChangeProtocolFeeRate(FeeRateType indexed feeRateType, uint256 indexed feeRate);
    event ChangeAverageGasPerAction(TradingOrderType indexed tradingOrderType, uint256 indexed averageGasPerAction);
    event ChangeMaxProtocolFee(uint256 indexed maxProtocolFee);
    event ChangeProtocolFeeCoefficient(uint256 indexed protocolFeeCoefficient);
    event ChangeLiquidationGasAmount(uint256 indexed liquidationGasAmount);
    event ChangePmxDiscountMultiplier(uint256 indexed pmxDiscountMultiplier);
    event ChangeAdditionalGasSpent(uint256 indexed additionalGasSpent);
    event ChangeGasPriceBuffer(uint256 indexed gasPriceBuffer);
    event ChangeMinFeeRestrictions(CallingMethod indexed callingMethod, MinFeeRestrictions minFeeRestrictions);

    /**
     * @param feeRateType The order type for which the rate is set
     * @param feeRate Setting rate in WAD format (1 WAD = 100%)
     */
    struct FeeRateParams {
        FeeRateType feeRateType;
        uint256 feeRate;
    }

    struct AverageGasPerActionParams {
        TradingOrderType tradingOrderType;
        uint256 averageGasPerAction;
    }

    /**
     * @dev Params for initialize() function
     * @param registry The address of the PrimexRegistry contract.
     * @param pmx The address of the PMX token contract.
     * @param treasury The address of the Treasury contract.
     * @param delistingDelay The time (in seconds) between deprecation and delisting of a bucket.
     * @param adminWithdrawalDelay The time (in seconds) between delisting of a bucket and an adminDeadline.
     * @param feeRateParams An array of structs to set protocol fee rate on the corresponding
     * @param averageGasPerActionParams An array of structs to set average amount of gas spent by Keeper on the corresponding action
     * @param maxProtocolFee MaxProtocolFee that can be charged. Measured in NATIVE_CURRENCY
     * @param liquidationGasAmount Average gas amount spent for a single liquidation, measured in wei.
     * @param protocolFeeCoefficient Additional coefficient to calculate minProtocolFee, measured in wei.
     * @param additionalGasSpent Gas that will be additionally spend after gasSpent calculation.
     * @param pmxDiscountMultiplier Multiplier for PMX discount calculation
     * @param gasPriceBuffer Multiplier which protects position from immediate liquidation after gas price changed
     */
    struct InitParams {
        address registry;
        address pmx;
        address treasury;
        uint256 delistingDelay;
        uint256 adminWithdrawalDelay;
        FeeRateParams[] feeRateParams;
        AverageGasPerActionParams[] averageGasPerActionParams;
        uint256 maxProtocolFee;
        uint256 liquidationGasAmount;
        uint256 protocolFeeCoefficient;
        uint256 additionalGasSpent;
        uint256 pmxDiscountMultiplier;
        uint256 gasPriceBuffer;
    }

    /**
     * @notice Initializes the contract with the specified parameters.
     */
    function initialize(InitParams calldata _params) external;

    /**
     * @notice Deprecates a bucket.
     * @dev This function is used to deprecate a bucket by changing its current status to "Deprecated".
     * Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _bucket The name of the bucket to deprecate.
     * Emits a BucketDeprecated event with the bucket address and the delisting time.
     */
    function deprecateBucket(string memory _bucket) external;

    /**
     * @notice This function is used to set the address of the Aave pool contract.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _aavePool The address of the Aave pool contract to be set.
     */
    function setAavePool(address _aavePool) external;

    /**
     * @notice Sets the address of the PMX token contract.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _pmx The address of the PMX token contract.
     */
    function setPMX(address _pmx) external;

    /**
     * @notice Activates a bucket by changing its status from inactive to active.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _bucket The bucket to activate.
     */
    function activateBucket(string memory _bucket) external;

    /**
     * @notice Freezes a bucket, preventing further operations on it,
     * by changing its status from active to inactive.
     * @dev Only callable by the EMERGENCY_ADMIN role.
     * @param _bucket The bucket to be frozen.
     */
    function freezeBucket(string memory _bucket) external;

    /**
     * @notice Adds a new bucket.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _newBucket The address of the new bucket to be added.
     * @param _pmxRewardAmount The amount of PMX tokens to be rewarded from the bucket.
     * Emits a AddNewBucket event with the struct BucketData of the newly added bucket.
     */
    function addBucket(address _newBucket, uint256 _pmxRewardAmount) external;

    /**
     * @notice Activates a DEX by changing flag isActive on to true.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _dex The name of the DEX to activate.
     */
    function activateDEX(string memory _dex) external;

    /**
     * @notice Freezes a DEX by changing flag isActive to false.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _dex The name of the DEX to be frozen.
     */
    function freezeDEX(string memory _dex) external;

    /**
     * @notice Adds a new DEX to the protocol.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _name The name of the DEX.
     * @param _routerAddress The address of the DEX router.
     */
    function addDEX(string memory _name, address _routerAddress) external;

    /**
     * @notice Sets the address of the DEX adapter.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param newAdapterAddress The address of the new DEX adapter.
     */
    function setDexAdapter(address newAdapterAddress) external;

    /**
     * @notice Set min protocol fee restrictions for different calling method.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     */
    function setMinFeeRestrictions(
        CallingMethod _callingMethod,
        MinFeeRestrictions calldata _minFeeRestrictions
    ) external;

    /**
     * @dev The function to specify the address of conditional manager of some type
     * 1 => LimitPriceCOM
     * 2 => TakeProfitStopLossCCM
     * @param _address Address to be set for a conditional manager
     * @param _cmType The type of a conditional manager
     */
    function setConditionalManager(uint256 _cmType, address _address) external;

    /**
     * @notice Retrieves the address of a bucket by its name.
     * @param _name The name of the bucket.
     * @return The address of the bucket.
     */
    function getBucketAddress(string memory _name) external view returns (address);

    /**
     * @notice Retrieves the address of the DEX router based on the given DEX name.
     * @param _name The name of the DEX.
     * @return The address of the DEX router.
     */
    function getDexAddress(string memory _name) external view returns (address);

    /**
     * @notice Retrieves the names of Dexes registered in the protocol.
     * @return An array of strings containing the names of all Dexes.
     */
    function getAllDexes() external view returns (string[] memory);

    /**
     * @notice Set the protocol fee rate for one type of order.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setProtocolFeeRate(FeeRateParams calldata _feeRateType) external;

    /**
     * @notice Set average gas amount of gas spent by Keeper on the corresponding action.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setAverageGasPerAction(AverageGasPerActionParams calldata _averageGasPerActionParams) external;

    /**
     * @notice Set the max protocol fee.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _maxProtocolFee The new max protocol fee.
     */
    function setMaxProtocolFee(uint256 _maxProtocolFee) external;

    /**
     * @notice Set protocol fee coefficient. Used to calculate the minProtocol fee
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setProtocolFeeCoefficient(uint256 _maxProtocolFee) external;

    /**
     * @notice Set liquidation gas amount (average gas amount spent for a single liquidation).
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setLiquidationGasAmount(uint256 _maxProtocolFee) external;

    /**
     * @notice Set pmxDiscountMultiplier.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setPmxDiscountMultiplier(uint256 _pmxDiscountMultiplier) external;

    /**
     * @notice Set new additionalGas. Used to calculate the minProtocol fee
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setAdditionalGasSpent(uint256 _additionalGasSpent) external;

    /**
     * @notice Set new gasPriceBuffer.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setGasPriceBuffer(uint256 _gasPriceBuffer) external;

    /**
     * @notice Retrieves pmx, treasury, feeRateType, maxProtocolFee, pmxDiscountMultiplier
     */
    function getPrimexDNSParams(
        FeeRateType _feeRateType
    ) external view returns (address, address, uint256, uint256, uint256);

    /**
     * @notice Retrieves liquidationGasAmount, protocolFeeCoefficient, additionalGasSpent, maxGasAmount and baseLength
     */
    function getParamsForMinProtocolFee(
        CallingMethod _callingMethod
    ) external view returns (uint256, uint256, uint256, uint256, uint256);

    /**
     * @notice Retrieves baseLength for L2 chain payment model depending from tradingOrderType
     */
    function getL1BaseLengthForTradingOrderType(TradingOrderType _tradingOrderType) external view returns (uint256);
}

interface IPrimexDNS is IPrimexDNSStorage {
    event AddNewBucket(BucketData newBucketData);
    event BucketDeprecated(address bucketAddress, uint256 delistingTime);
    event AddNewDex(DexData newDexData);
    event ChangeFeeRate(OrderType orderType, address token, uint256 rate);
    event ConditionalManagerChanged(uint256 indexed cmType, address indexed cmAddress);
    event PMXchanged(address indexed pmx);
    event AavePoolChanged(address indexed aavePool);
    event BucketActivated(address indexed bucketAddress);
    event BucketFrozen(address indexed bucketAddress);
    event DexAdapterChanged(address indexed newAdapterAddress);
    event DexActivated(address indexed routerAddress);
    event DexFrozen(address indexed routerAddress);

    /**
     * @param orderType The order type for which the rate is set
     * @param feeToken The token address for which the rate is set
     * @param rate Setting rate in WAD format (1 WAD = 100%)
     */
    struct FeeRateParams {
        OrderType orderType;
        address feeToken;
        uint256 rate;
    }

    /**
     * @notice Initializes the contract with the specified parameters.
     * @param _registry The address of the PrimexRegistry contract.
     * @param _pmx The address of the PMX token contract.
     * @param _treasury The address of the Treasury contract.
     * @param _delistingDelay The time (in seconds) between deprecation and delisting of a bucket.
     * @param _adminWithdrawalDelay The time (in seconds) between delisting of a bucket and an adminDeadline.
     * @param _feeRateParams Initial fee params
     */
    function initialize(
        address _registry,
        address _pmx,
        address _treasury,
        uint256 _delistingDelay,
        uint256 _adminWithdrawalDelay,
        FeeRateParams[] calldata _feeRateParams
    ) external;

    /**
     * @notice Deprecates a bucket.
     * @dev This function is used to deprecate a bucket by changing its current status to "Deprecated".
     * Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _bucket The name of the bucket to deprecate.
     * Emits a BucketDeprecated event with the bucket address and the delisting time.
     */
    function deprecateBucket(string memory _bucket) external;

    /**
     * @notice This function is used to set the address of the Aave pool contract.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _aavePool The address of the Aave pool contract to be set.
     */
    function setAavePool(address _aavePool) external;

    /**
     * @notice Sets the protocol rate in PMX.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setFeeRate(FeeRateParams calldata _feeRateParams) external;

    /**
     * @notice Sets the address of the PMX token contract.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _pmx The address of the PMX token contract.
     */
    function setPMX(address _pmx) external;

    /**
     * @notice Activates a bucket by changing its status from inactive to active.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _bucket The bucket to activate.
     */
    function activateBucket(string memory _bucket) external;

    /**
     * @notice Freezes a bucket, preventing further operations on it,
     * by changing its status from active to inactive.
     * @dev Only callable by the EMERGENCY_ADMIN role.
     * @param _bucket The bucket to be frozen.
     */
    function freezeBucket(string memory _bucket) external;

    /**
     * @notice Adds a new bucket.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _newBucket The address of the new bucket to be added.
     * @param _pmxRewardAmount The amount of PMX tokens to be rewarded from the bucket.
     * Emits a AddNewBucket event with the struct BucketData of the newly added bucket.
     */
    function addBucket(address _newBucket, uint256 _pmxRewardAmount) external;

    /**
     * @notice Activates a DEX by changing flag isActive on to true.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _dex The name of the DEX to activate.
     */
    function activateDEX(string memory _dex) external;

    /**
     * @notice Freezes a DEX by changing flag isActive to false.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _dex The name of the DEX to be frozen.
     */
    function freezeDEX(string memory _dex) external;

    /**
     * @notice Adds a new DEX to the protocol.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _name The name of the DEX.
     * @param _routerAddress The address of the DEX router.
     */
    function addDEX(string memory _name, address _routerAddress) external;

    /**
     * @notice Sets the address of the DEX adapter.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param newAdapterAddress The address of the new DEX adapter.
     */
    function setDexAdapter(address newAdapterAddress) external;

    /**
     * @dev The function to specify the address of conditional manager of some type
     * 1 => LimitPriceCOM
     * 2 => TakeProfitStopLossCCM
     * @param _address Address to be set for a conditional manager
     * @param _cmType The type of a conditional manager
     */
    function setConditionalManager(uint256 _cmType, address _address) external;

    /**
     * @notice Retrieves the address of a bucket by its name.
     * @param _name The name of the bucket.
     * @return The address of the bucket.
     */
    function getBucketAddress(string memory _name) external view returns (address);

    /**
     * @notice Retrieves the address of the DEX router based on the given DEX name.
     * @param _name The name of the DEX.
     * @return The address of the DEX router.
     */
    function getDexAddress(string memory _name) external view returns (address);

    /**
     * @notice Retrieves the names of Dexes registered in the protocol.
     * @return An array of strings containing the names of all Dexes.
     */
    function getAllDexes() external view returns (string[] memory);
}
