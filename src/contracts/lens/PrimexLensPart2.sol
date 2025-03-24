// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import "./../libraries/Errors.sol";

import {IPrimexLensPart2, IPrimexLens, IInterestRateStrategy, ILiquidityMiningRewardDistributor} from "../interfaces/IPrimexLensPart2.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IBucketsFactory} from "../Bucket/IBucketsFactory.sol";

import {IPrimexDNSV3, IPrimexDNSStorageV3, IPrimexDNSStorage} from "../PrimexDNS/PrimexDNS.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {ARB_NITRO_ORACLE, GAS_FOR_BYTE, OVM_GASPRICEORACLE, TRANSACTION_METADATA_BYTES} from "../Constants.sol";
import {IDepositManager} from "../DepositManager/IDepositManager.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {SECONDS_PER_YEAR} from "../Constants.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

/**
 * @dev  All functions in this contract are intended to be called off-chain. Do not call functions from other contracts to avoid an out-of-gas error.
 */

contract PrimexLensPart2 is IPrimexLensPart2, ERC165 {
    using WadRayMath for uint256;
    IPrimexLens internal primexLens;

    constructor(address _primexLens) {
        primexLens = IPrimexLens(_primexLens);
    }

    /**
     * @inheritdoc IPrimexLensPart2
     */
    function getEstimatedMinProtocolFeeLiquidation(IPositionManagerV2 _pm) public view override returns (uint256) {
        uint256 restrictedGasPrice = PrimexPricingLibrary.calculateRestrictedGasPrice(
            address(_pm.priceOracle()),
            _pm.keeperRewardDistributor()
        );

        IPrimexDNSV3 primexDNS = _pm.primexDNS();

        (, , uint256 optimisticGasCoefficient, IKeeperRewardDistributorStorage.PaymentModel paymentModel) = _pm
            .keeperRewardDistributor()
            .getGasCalculationParams();

        (uint256 liquidationGasAmount, uint256 protocolFeeCoefficient, , , uint256 baseLength) = primexDNS
            .getParamsForMinProtocolFee(IPrimexDNSStorageV3.CallingMethod.ClosePositionByCondition);
        uint256 l1CostWei;

        if (paymentModel != IKeeperRewardDistributorStorage.PaymentModel.DEFAULT) {
            if (paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM) {
                l1CostWei =
                    ARB_NITRO_ORACLE.getL1BaseFeeEstimate() *
                    GAS_FOR_BYTE *
                    (baseLength + TRANSACTION_METADATA_BYTES);
            }
            if (paymentModel == IKeeperRewardDistributorStorage.PaymentModel.OPTIMISTIC) {
                l1CostWei = OVM_GASPRICEORACLE.getL1FeeUpperBound(baseLength).wmul(optimisticGasCoefficient);
                // because we can't consider l2 a gas on the OPTIMISTIC chains
                return l1CostWei + protocolFeeCoefficient;
            }
        }
        uint256 estimatedMinProtocolFeeInNativeAsset = liquidationGasAmount *
            restrictedGasPrice +
            l1CostWei +
            protocolFeeCoefficient;
        return estimatedMinProtocolFeeInNativeAsset;
    }

    function hasEnoughRewardsInDepositManager(
        CheckRewardParams calldata _params,
        IDepositManager _depositManager,
        address priceOracle
    ) external payable override returns (bool isEnough, uint256 remainingReward, uint256 maxDepositAmount) {
        IBucketV3 bucket = IBucketV3(_params.bucket);

        uint256 rewardPercent = _depositManager.interestRates(_params.bucket, _params.rewardToken, _params.duration);
        _require(rewardPercent > 0, Errors.REWARD_PERCENT_SHOULD_BE_GREATER_THAN_ZERO.selector);

        remainingReward = IERC20(_params.rewardToken).balanceOf(address(_depositManager));

        uint256 maxPayReward = WadRayMath.wdiv(
            ((remainingReward * SECONDS_PER_YEAR) / _params.duration),
            rewardPercent
        );

        maxDepositAmount = PrimexPricingLibrary.getOracleAmountsOut(
            _params.rewardToken,
            address(bucket.borrowedAsset()),
            maxPayReward,
            priceOracle,
            _params.borrowedRewardAssetOracleData
        );
        isEnough = maxDepositAmount >= _params.amount;
    }

    /**
     * @inheritdoc IPrimexLensPart2
     */
    function getAllBucketsFactory(
        address[] calldata _bucketFactories,
        address _user,
        address _positionManager,
        bool _showDeprecated,
        uint256 _cursor,
        uint256 _count
    ) external view override returns (BucketMetaDataPart2[] memory, uint256) {
        uint256 newCursor;
        address[][] memory allBucketsArray = new address[][](_bucketFactories.length);
        for (uint256 i; i < _bucketFactories.length; i++) {
            allBucketsArray[i] = IBucketsFactory(_bucketFactories[i]).allBuckets();
        }
        uint256 totalBucketsCount;
        for (uint256 i; i < allBucketsArray.length; i++) {
            totalBucketsCount += allBucketsArray[i].length;
        }

        if (_cursor >= totalBucketsCount) {
            return (new BucketMetaDataPart2[](0), newCursor);
        }
        if (_cursor + _count >= totalBucketsCount) {
            _count = totalBucketsCount - _cursor;
        } else {
            newCursor = _cursor + _count;
        }

        address[] memory buckets = new address[](totalBucketsCount);
        address[] memory requestedBuckets = new address[](_count);
        uint256 index;
        for (uint256 i; i < allBucketsArray.length; i++) {
            for (uint256 j; j < allBucketsArray[i].length; j++) {
                buckets[index] = allBucketsArray[i][j];
                index++;
            }
        }
        for (uint256 i; i < _count; i++) {
            requestedBuckets[i] = buckets[_cursor + i];
        }

        return (getBucketsArray(requestedBuckets, _user, _positionManager, _showDeprecated), newCursor);
    }

    /**
     * @inheritdoc IPrimexLensPart2
     */
    function getBucketsArray(
        address[] memory _buckets,
        address _user,
        address _positionManager,
        bool _showDeprecated
    ) public view override returns (BucketMetaDataPart2[] memory) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        IPrimexDNSStorage.Status[] memory statuses = new IPrimexDNSStorage.Status[](_buckets.length);
        uint256 bucketCount;
        IPrimexDNSV3 dns = IPositionManagerV2(_positionManager).primexDNS();
        for (uint256 i; i < _buckets.length; i++) {
            IBucketV3 bucket = IBucketV3(_buckets[i]);
            (address bucketAddress, IPrimexDNSStorage.Status currentStatus, , ) = dns.buckets(bucket.name());
            if (
                (_showDeprecated ||
                    !(currentStatus == IPrimexDNSStorage.Status.Deprecated && bucket.pToken().balanceOf(_user) == 0)) &&
                bucketAddress == _buckets[i]
            ) {
                _buckets[bucketCount] = _buckets[i];
                statuses[bucketCount] = currentStatus;
                bucketCount++;
            }
        }
        BucketMetaDataPart2[] memory res = new BucketMetaDataPart2[](bucketCount);
        for (uint256 i; i < bucketCount; i++) {
            res[i] = _getBucket(_buckets[i], _user, statuses[i]);
        }
        return res;
    }

    function _getBucket(
        address _bucket,
        address _user,
        IPrimexDNSStorage.Status _status
    ) internal view returns (BucketMetaDataPart2 memory) {
        _require(
            IERC165(_bucket).supportsInterface(type(IBucketV3).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        uint256 availableLiquidity = IBucketV3(_bucket).availableLiquidity();
        uint256 demand = IBucketV3(_bucket).debtToken().totalSupply();
        uint256 supply = demand + availableLiquidity;
        uint256 ur = supply > 0 ? demand.rdiv(supply) : 0;

        address[] memory allowedAssets = IBucketV3(_bucket).getAllowedAssets();
        IPrimexLens.SupportedAsset[] memory supportedAssets = primexLens.getSupportedAssetArray(
            _bucket,
            allowedAssets,
            _user
        );
        // solhint-disable-next-line var-name-mixedcase
        IBucketV3.LiquidityMiningParams memory LMparams = IBucketV3(_bucket).getLiquidityMiningParams();
        IInterestRateStrategy.BarCalculationParams memory barCalcParams = IBucketV3(_bucket)
            .interestRateStrategy()
            .getBarCalculationParams(_bucket);
        return
            BucketMetaDataPart2({
                bucketAddress: _bucket,
                name: IBucketV3(_bucket).name(),
                asset: primexLens.getTokenMetadata(address(IBucketV3(_bucket).borrowedAsset()), _user),
                bar: IBucketV3(_bucket).bar(),
                lar: IBucketV3(_bucket).lar(),
                supply: supply,
                demand: demand,
                availableLiquidity: availableLiquidity,
                utilizationRatio: ur,
                supportedAssets: supportedAssets,
                pToken: primexLens.getTokenMetadata(address(IBucketV3(_bucket).pToken()), _user),
                debtToken: primexLens.getTokenMetadata(address(IBucketV3(_bucket).debtToken()), _user),
                feeBuffer: IBucketV3(_bucket).feeBuffer(),
                withdrawalFeeRate: IBucketV3(_bucket).withdrawalFeeRate(),
                miningParams: LMparams,
                lenderInfo: primexLens.getLenderInfo(
                    LMparams.liquidityMiningRewardDistributor,
                    IBucketV3(_bucket).name(),
                    _user
                ),
                lmBucketInfo: primexLens.getLMBucketInfo(
                    LMparams.liquidityMiningRewardDistributor,
                    IBucketV3(_bucket).name()
                ),
                estimatedBar: IBucketV3(_bucket).estimatedBar(),
                estimatedLar: IBucketV3(_bucket).estimatedLar(),
                isDeprecated: IBucketV3(_bucket).isDeprecated(),
                isDelisted: IBucketV3(_bucket).isDelisted(),
                barCalcParams: barCalcParams,
                maxTotalDeposit: IBucketV3(_bucket).maxTotalDeposit(),
                liquidityIndex: IBucketV3(_bucket).liquidityIndex(),
                currentStatus: _status
            });
    }
}
