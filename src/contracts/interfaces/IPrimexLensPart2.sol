// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IPrimexDNSStorageV3, IPrimexDNSStorage} from "../PrimexDNS/PrimexDNS.sol";
import {IDepositManager} from "../DepositManager/IDepositManager.sol";
import "./IPrimexLens.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";

interface IPrimexLensPart2 {
    struct CheckRewardParams {
        address bucket;
        uint256 amount;
        uint256 duration;
        address rewardToken;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
        bytes borrowedRewardAssetOracleData;
    }

    /**
     * @dev Struct representing info about bucket.
     * @param bucketAddress The bucket address.
     * @param name The bucket name.
     * @param asset TokenMetadata of borrowed asset of the bucket.
     * @param bar Borrowing annual rate of the bucket, expressed in RAY.
     * @param lar Lending annual rate of the bucket, expressed in RAY.
     * @param supply Sum of availableLiquidity and demand, in borrowed asset.
     * @param demand Total supply of the debtToken, in borrowed asset.
     * @param availableLiquidity Balance of borrowed asset on the bucket, in borrowed asset.
     * @param utilizationRatio Percentage of the bucket funds used in the loan, in in RAY format (1 RAY = 100%).
     * @param supportedAssets Assets with which you can open a position in the bucket.
     * @param pToken TokenMetadata of pToken of the bucket.
     * @param debtToken TokenMetadata of debtToken of the bucket.
     * @param feeBuffer The fee buffer of the bucket, in WAD format.
     * @param withdrawalFeeRate Percentage of withdrawal that is redirected to the treasury, in WAD format (1 WAD = 100%)
     * @param miningParams Parameters of the bucket liquidity mining.
     * @param lenderInfo Liquidity mining lender information.
     * @param lmBucketInfo Liquidity mining the bucket information.
     * @param estimatedBar Expected value of bar, expressed in RAY
     * @param estimatedLar Expected value of lar., expressed in RAY
     * @param isDeprecated Indicates whether the bucket is outdated and deprecated.
     * @param isDelisted Indicates whether the bucket is delisted.
     * @param barCalcParams The BarCalculationParams struct containing the parameters for calculating bar and lar.
     * @param maxTotalDeposit Max amount of borrowed asset that can be deposited in bucket, in borrowed asset.
     * @param liquidityIndex The liquidity index of the bucket
     * @param currentStatus The current status of the bucket
     */
    struct BucketMetaDataPart2 {
        address bucketAddress;
        string name;
        IPrimexLens.TokenMetadata asset;
        uint128 bar;
        uint128 lar;
        uint256 supply;
        uint256 demand;
        uint256 availableLiquidity;
        uint256 utilizationRatio;
        IPrimexLens.SupportedAsset[] supportedAssets;
        IPrimexLens.TokenMetadata pToken;
        IPrimexLens.TokenMetadata debtToken;
        uint256 feeBuffer;
        uint256 withdrawalFeeRate;
        IBucketV3.LiquidityMiningParams miningParams;
        IPrimexLens.LenderInfo lenderInfo;
        IPrimexLens.LiquidityMiningBucketInfo lmBucketInfo;
        uint128 estimatedBar;
        uint128 estimatedLar;
        bool isDeprecated;
        bool isDelisted;
        IInterestRateStrategy.BarCalculationParams barCalcParams;
        uint256 maxTotalDeposit;
        uint256 liquidityIndex;
        IPrimexDNSStorage.Status currentStatus;
    }

    /**
     * @notice Calculate min protocol fee during liquidation,
     * @param _pm The instance of the PositionManager contract.
     */
    function getEstimatedMinProtocolFeeLiquidation(IPositionManagerV2 _pm) external view returns (uint256);

    /**
     * @notice Calculates whether the reward token is enough with the passed parameters
     * @param _params The params for calculation
     * @return isEnough whether there are enough tokens
     * @return remainingReward Remainder in reward tokens
     * @return maxDepositAmount The maximum amount of deposit tokens that can be provided by the balance of reward token
     */
    function hasEnoughRewardsInDepositManager(
        CheckRewardParams calldata _params,
        IDepositManager _depositManager,
        address priceOracle
    ) external payable returns (bool isEnough, uint256 remainingReward, uint256 maxDepositAmount);

    /**
     * @notice Retrieves all bucket metadata from a bucket factory contract.
     * @param _bucketFactories An array of the BucketFactory contracts addresses.
     * @param _trader The address of the trader for whom the buckets are retrieved.
     * @param _positionManager The address of the PositionManager contract.
     * @param _showDeprecated A boolean flag indicating whether to include deprecated buckets in the result.
     * @param _cursor The cursor value for pagination.
     * @param _count The number of positions to retrieve.
     * @return newCursor The new cursor value for pagination.
     * @return An array of BucketMetaData structs representing the bucket metadata.
     */
    function getAllBucketsFactory(
        address[] calldata _bucketFactories,
        address _trader,
        address _positionManager,
        bool _showDeprecated,
        uint256 _cursor,
        uint256 _count
    ) external view returns (BucketMetaDataPart2[] memory, uint256);

    /**
     * @notice Retrieves an array of `BucketMetaData` for the given `_user`.
     * @param _buckets The array of bucket addresses.
     * @param _user The address of the trader.
     * @param _positionManager The address of the PositionManager contract.
     * @param _showDeprecated Flag to determine whether deprecated buckets should be included.
     * @return An array of `BucketMetaDataPart2` objects.
     */
    function getBucketsArray(
        address[] memory _buckets,
        address _user,
        address _positionManager,
        bool _showDeprecated
    ) external view returns (BucketMetaDataPart2[] memory);
}
