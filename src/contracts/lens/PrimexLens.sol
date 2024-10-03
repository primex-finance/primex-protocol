// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import "./../libraries/Errors.sol";

import {IPrimexLens} from "../interfaces/IPrimexLens.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IBucketsFactory} from "../Bucket/IBucketsFactory.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {ILimitOrderManager} from "../LimitOrderManager/ILimitOrderManager.sol";
import {ITakeProfitStopLossCCM} from "../interfaces/ITakeProfitStopLossCCM.sol";
import {ILiquidityMiningRewardDistributor} from "../LiquidityMiningRewardDistributor/ILiquidityMiningRewardDistributor.sol";
import {IInterestRateStrategy} from "../interfaces/IInterestRateStrategy.sol";
import {IPrimexDNSV3, IPrimexDNSStorage, IPrimexDNSStorageV3} from "../PrimexDNS/PrimexDNS.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {ARB_NITRO_ORACLE, GAS_FOR_BYTE, TRANSACTION_METADATA_BYTES} from "../Constants.sol";

/**
 * @dev  All functions in this contract are intended to be called off-chain. Do not call functions from other contracts to avoid an out-of-gas error.
 */

contract PrimexLens is IPrimexLens, ERC165 {
    using WadRayMath for uint256;
    using PositionLibrary for PositionLibrary.Position;

    address public immutable takeProfitStopLossCCM;

    constructor(address _takeProfitStopLossCCM) {
        _require(
            IERC165(_takeProfitStopLossCCM).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        takeProfitStopLossCCM = _takeProfitStopLossCCM;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getOpenPositionsWithConditions(
        address _positionManager,
        uint256 _cursor,
        uint256 _count
    )
        external
        view
        override
        returns (OpenPositionWithConditions[] memory openPositionsWithConditions, uint256 newCursor)
    {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        uint256 positionsLength = IPositionManagerV2(_positionManager).getAllPositionsLength();
        if (_cursor >= positionsLength) {
            return (openPositionsWithConditions, 0);
        }
        if (_cursor + _count >= positionsLength) {
            _count = positionsLength - _cursor;
        } else {
            newCursor = _cursor + _count;
        }

        openPositionsWithConditions = new OpenPositionWithConditions[](_count);
        for (uint256 i; i < _count; i++) {
            openPositionsWithConditions[i].positionData = IPositionManagerV2(_positionManager).getPositionByIndex(
                _cursor + i
            );
            openPositionsWithConditions[i].conditionsData = IPositionManagerV2(_positionManager).getCloseConditions(
                openPositionsWithConditions[i].positionData.id
            );
        }
        return (openPositionsWithConditions, newCursor);
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getArrayOpenPositionDataByTrader(
        address _positionManager,
        address _trader,
        uint256 _cursor,
        uint256 _count
    ) external view override returns (OpenPositionData[] memory positionsData, uint256 newCursor) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId) && _trader != address(0),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        uint256 positionsLength = IPositionManagerV2(_positionManager).getTraderPositionsLength(_trader);
        if (_cursor >= positionsLength) {
            return (positionsData, 0);
        }
        if (_cursor + _count >= positionsLength) {
            _count = positionsLength - _cursor;
        } else {
            newCursor = _cursor + _count;
        }

        positionsData = new OpenPositionData[](_count);
        for (uint256 i; i < _count; i++) {
            uint256 positionId = IPositionManagerV2(_positionManager).traderPositionIds(_trader, _cursor + i);
            positionsData[i] = getOpenPositionData(_positionManager, positionId);
        }
        return (positionsData, newCursor);
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getArrayOpenPositionDataByBucket(
        address _positionManager,
        address _bucket,
        uint256 _cursor,
        uint256 _count
    ) external view override returns (OpenPositionData[] memory positionsData, uint256 newCursor) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId) && _bucket != address(0),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        uint256 positionsLength = IPositionManagerV2(_positionManager).getBucketPositionsLength(_bucket);
        if (_cursor >= positionsLength) {
            return (positionsData, 0);
        }
        if (_cursor + _count >= positionsLength) {
            _count = positionsLength - _cursor;
        } else {
            newCursor = _cursor + _count;
        }

        positionsData = new OpenPositionData[](_count);
        for (uint256 i; i < _count; i++) {
            uint256 positionId = IPositionManagerV2(_positionManager).bucketPositionIds(_bucket, _cursor + i);
            positionsData[i] = getOpenPositionData(_positionManager, positionId);
        }
        return (positionsData, newCursor);
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getAllBucketsFactory(
        address[] calldata _bucketFactories,
        address _user,
        address _positionManager,
        bool _showDeprecated
    ) external view override returns (BucketMetaData[] memory) {
        address[][] memory allBucketsArray = new address[][](_bucketFactories.length);
        for (uint256 i; i < _bucketFactories.length; i++) {
            allBucketsArray[i] = IBucketsFactory(_bucketFactories[i]).allBuckets();
        }
        uint256 totalBucketsCount;
        for (uint256 i; i < allBucketsArray.length; i++) {
            totalBucketsCount += allBucketsArray[i].length;
        }
        address[] memory buckets = new address[](totalBucketsCount);
        uint256 index;
        for (uint256 i; i < allBucketsArray.length; i++) {
            for (uint256 j; j < allBucketsArray[i].length; j++) {
                buckets[index] = allBucketsArray[i][j];
                index++;
            }
        }

        return getBucketsArray(buckets, _user, _positionManager, _showDeprecated);
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getChainlinkLatestRoundData(
        address[] calldata _feeds
    ) external view override returns (RoundData[] memory) {
        uint256 feedCount = _feeds.length;
        RoundData[] memory res = new RoundData[](feedCount);

        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;

        for (uint256 i; i < feedCount; i++) {
            _require(_feeds[i] != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
            (roundId, answer, startedAt, updatedAt, answeredInRound) = AggregatorV3Interface(_feeds[i])
                .latestRoundData();
            res[i].roundId = roundId;
            res[i].answer = answer;
            res[i].startedAt = startedAt;
            res[i].updatedAt = updatedAt;
            res[i].answeredInRound = answeredInRound;
        }

        return res;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    // getLiquidationPrice for openable positions
    // in an ideal situation this liquidationPrice is equal getLiquidationPrice for opened positions
    function getLiquidationPrice(
        address _positionManager,
        string memory _bucket,
        uint256 _borrowedAmount,
        address _positionAsset,
        uint256 _positionAmount
    ) external view override returns (uint256) {
        _require(
            IERC165(address(_positionManager)).supportsInterface(type(IPositionManagerV2).interfaceId) &&
                _positionAsset != address(0),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        address bucket = IPositionManagerV2(_positionManager).primexDNS().getBucketAddress(_bucket);

        return PrimexPricingLibrary.getLiquidationPrice(bucket, _positionAsset, _positionAmount, _borrowedAmount);
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getLimitOrdersWithConditions(
        address _limitOrderManager,
        uint256 _cursor,
        uint256 _count
    ) external view override returns (LimitOrderWithConditions[] memory limitOrdersWithConditions, uint256 newCursor) {
        _require(
            IERC165(_limitOrderManager).supportsInterface(type(ILimitOrderManager).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        uint256 ordersLength = ILimitOrderManager(_limitOrderManager).getOrdersLength();
        if (_cursor >= ordersLength) {
            return (limitOrdersWithConditions, 0);
        }
        if (_cursor + _count >= ordersLength) {
            _count = ordersLength - _cursor;
        } else {
            newCursor = _cursor + _count;
        }
        limitOrdersWithConditions = new LimitOrderWithConditions[](_count);
        for (uint256 i; i < _count; i++) {
            limitOrdersWithConditions[i].limitOrderData = ILimitOrderManager(_limitOrderManager).getOrderByIndex(
                _cursor + i
            );
            limitOrdersWithConditions[i].openConditionsData = ILimitOrderManager(_limitOrderManager).getOpenConditions(
                limitOrdersWithConditions[i].limitOrderData.id
            );
        }
        return (limitOrdersWithConditions, newCursor);
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getTokenArrayMetadata(
        address[] calldata _tokens,
        address _trader
    ) external view override returns (TokenMetadata[] memory) {
        uint256 tokenCount = _tokens.length;
        TokenMetadata[] memory res = new TokenMetadata[](tokenCount);

        for (uint256 i; i < tokenCount; i++) {
            res[i] = getTokenMetadata(_tokens[i], _trader);
        }

        return res;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getOpenPositionData(
        address _positionManager,
        uint256 _id
    ) public view override returns (OpenPositionData memory) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        PositionLibrary.Position memory position = IPositionManagerV2(_positionManager).getPosition(_id);

        bool isSpot = address(position.bucket) == address(0);
        uint256 debt = IPositionManagerV2(_positionManager).getPositionDebt(_id);
        BucketMetaData memory bucket;
        if (!isSpot) bucket = getBucket(address(position.bucket), position.trader);

        LimitOrderLibrary.Condition[] memory closeConditions = IPositionManagerV2(_positionManager).getCloseConditions(
            _id
        );
        ITakeProfitStopLossCCM.CanBeClosedParams memory params;
        for (uint256 i; i < closeConditions.length; i++) {
            if (
                IERC165(
                    IPositionManagerV2(_positionManager).primexDNS().cmTypeToAddress(closeConditions[i].managerType)
                ).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId) && closeConditions[i].params.length != 0
            ) {
                params = abi.decode(closeConditions[i].params, (ITakeProfitStopLossCCM.CanBeClosedParams));
                break;
            }
        }
        return
            OpenPositionData({
                id: position.id,
                bucket: bucket,
                pair: [
                    isSpot ? getTokenMetadata(position.soldAsset, position.trader) : bucket.asset,
                    getTokenMetadata(position.positionAsset, position.trader)
                ],
                positionSize: position.positionAmount,
                liquidationPrice: getLiquidationPrice(_positionManager, _id),
                stopLossPrice: params.stopLossPrice,
                takeProfitPrice: params.takeProfitPrice,
                debt: debt,
                depositAmount: position.depositAmountInSoldAsset,
                createdAt: position.createdAt
            });
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function isStopLossReached(
        address _positionManager,
        uint256 _id,
        bytes calldata _positionSoldAssetOracleData
    ) public override returns (bool) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        PositionLibrary.Position memory position = IPositionManagerV2(_positionManager).getPosition(_id);
        LimitOrderLibrary.Condition[] memory closeConditions = IPositionManagerV2(_positionManager).getCloseConditions(
            _id
        );

        if (closeConditions.length == 0) return false;

        ITakeProfitStopLossCCM.CanBeClosedParams memory params;

        for (uint256 i; i < closeConditions.length; i++) {
            if (
                IERC165(
                    IPositionManagerV2(_positionManager).primexDNS().cmTypeToAddress(closeConditions[i].managerType)
                ).supportsInterface(type(ITakeProfitStopLossCCM).interfaceId)
            ) {
                params = abi.decode(closeConditions[i].params, (ITakeProfitStopLossCCM.CanBeClosedParams));
                break;
            }
        }
        return
            ITakeProfitStopLossCCM(takeProfitStopLossCCM).isStopLossReached(
                position,
                params.stopLossPrice,
                _positionSoldAssetOracleData
            );
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getTokenMetadata(address _token, address _trader) public view override returns (TokenMetadata memory) {
        _require(_token != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        return
            TokenMetadata({
                tokenAddress: _token,
                symbol: IERC20Metadata(_token).symbol(),
                name: IERC20Metadata(_token).name(),
                decimals: IERC20Metadata(_token).decimals(),
                balance: _trader != address(0) ? IERC20Metadata(_token).balanceOf(_trader) : 0
            });
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getAssetMetadata(
        address _bucket,
        address _asset
    ) public view override returns (BucketTokenMetadata memory) {
        _require(
            IERC165(_bucket).supportsInterface(type(IBucketV3).interfaceId) && _asset != address(0),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        IPositionManagerV2 pm = IBucketV3(_bucket).positionManager();
        uint256 pairPriceDrop = pm.priceOracle().pairPriceDrops(_asset, address(IBucketV3(_bucket).borrowedAsset()));

        (uint256 id, bool isSupported) = IBucketV3(_bucket).allowedAssets(_asset);
        return
            BucketTokenMetadata({
                id: id,
                isSupported: isSupported,
                pairPriceDrop: pairPriceDrop,
                // TODO: what FeeRateType should be used here?
                maxLeverage: IBucketV3(_bucket).maxAssetLeverage(
                    _asset,
                    pm.primexDNS().protocolFeeRates(IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByKeeper)
                )
            });
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getSupportedAsset(
        address _bucket,
        address _asset,
        address _trader
    ) public view override returns (SupportedAsset memory) {
        return
            SupportedAsset({asset: getTokenMetadata(_asset, _trader), properties: getAssetMetadata(_bucket, _asset)});
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getSupportedAssetArray(
        address _bucket,
        address[] memory _assets,
        address _trader
    ) public view override returns (SupportedAsset[] memory) {
        uint256 assetCount = _assets.length;
        SupportedAsset[] memory res = new SupportedAsset[](assetCount);

        for (uint256 i; i < assetCount; i++) {
            res[i] = getSupportedAsset(_bucket, _assets[i], _trader);
        }

        return res;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getBucket(address _bucket, address _user) public view override returns (BucketMetaData memory) {
        _require(
            IERC165(_bucket).supportsInterface(type(IBucketV3).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        uint256 availableLiquidity = IBucketV3(_bucket).availableLiquidity();
        uint256 demand = IBucketV3(_bucket).debtToken().totalSupply();
        uint256 supply = demand + availableLiquidity;
        uint256 ur = supply > 0 ? demand.rdiv(supply) : 0;

        address[] memory allowedAssets = IBucketV3(_bucket).getAllowedAssets();
        SupportedAsset[] memory supportedAssets = getSupportedAssetArray(_bucket, allowedAssets, _user);
        // solhint-disable-next-line var-name-mixedcase
        IBucketV3.LiquidityMiningParams memory LMparams = IBucketV3(_bucket).getLiquidityMiningParams();
        IInterestRateStrategy.BarCalculationParams memory barCalcParams = IBucketV3(_bucket)
            .interestRateStrategy()
            .getBarCalculationParams(_bucket);
        return
            BucketMetaData({
                bucketAddress: _bucket,
                name: IBucketV3(_bucket).name(),
                asset: getTokenMetadata(address(IBucketV3(_bucket).borrowedAsset()), _user),
                bar: IBucketV3(_bucket).bar(),
                lar: IBucketV3(_bucket).lar(),
                supply: supply,
                demand: demand,
                availableLiquidity: availableLiquidity,
                utilizationRatio: ur,
                supportedAssets: supportedAssets,
                pToken: getTokenMetadata(address(IBucketV3(_bucket).pToken()), _user),
                debtToken: getTokenMetadata(address(IBucketV3(_bucket).debtToken()), _user),
                feeBuffer: IBucketV3(_bucket).feeBuffer(),
                withdrawalFeeRate: IBucketV3(_bucket).withdrawalFeeRate(),
                miningParams: LMparams,
                lenderInfo: getLenderInfo(LMparams.liquidityMiningRewardDistributor, IBucketV3(_bucket).name(), _user),
                lmBucketInfo: getLMBucketInfo(LMparams.liquidityMiningRewardDistributor, IBucketV3(_bucket).name()),
                estimatedBar: IBucketV3(_bucket).estimatedBar(),
                estimatedLar: IBucketV3(_bucket).estimatedLar(),
                isDeprecated: IBucketV3(_bucket).isDeprecated(),
                isDelisted: IBucketV3(_bucket).isDelisted(),
                barCalcParams: barCalcParams,
                maxTotalDeposit: IBucketV3(_bucket).maxTotalDeposit()
            });
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getLenderInfo(
        ILiquidityMiningRewardDistributor liquidityMiningRewardDistributor,
        string memory bucketName,
        address user
    ) public view override returns (LenderInfo memory) {
        LenderInfo memory info;
        if (address(liquidityMiningRewardDistributor) == address(0)) return info;
        (info.amountInMining, info.currentPercent, info.rewardsInPMX) = liquidityMiningRewardDistributor.getLenderInfo(
            bucketName,
            user,
            block.timestamp
        );
        return info;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getLMBucketInfo(
        ILiquidityMiningRewardDistributor liquidityMiningRewardDistributor,
        string memory bucketName
    ) public view override returns (LiquidityMiningBucketInfo memory) {
        LiquidityMiningBucketInfo memory info;
        if (address(liquidityMiningRewardDistributor) == address(0)) return info;
        (info.pmxAmount, info.withdrawnRewards, info.totalPoints) = liquidityMiningRewardDistributor.getBucketInfo(
            bucketName
        );
        return info;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getBucketsArray(
        address[] memory _buckets,
        address _user,
        address _positionManager,
        bool _showDeprecated
    ) public view override returns (BucketMetaData[] memory) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        uint256 bucketCount;
        for (uint256 i; i < _buckets.length; i++) {
            IBucketV3 bucket = IBucketV3(_buckets[i]);
            (address bucketAddress, IPrimexDNSStorage.Status currentStatus, , ) = IPositionManagerV2(_positionManager)
                .primexDNS()
                .buckets(bucket.name());
            if (
                (_showDeprecated ||
                    !(currentStatus == IPrimexDNSStorage.Status.Deprecated && bucket.pToken().balanceOf(_user) == 0)) &&
                bucketAddress == _buckets[i]
            ) {
                _buckets[bucketCount] = _buckets[i];
                bucketCount++;
            }
        }
        BucketMetaData[] memory res = new BucketMetaData[](bucketCount);
        for (uint256 i; i < bucketCount; i++) {
            res[i] = getBucket(_buckets[i], _user);
        }
        return res;
    }

    /**
     * @notice Interface checker
     * @param interfaceId The interface id to check
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IPrimexLens).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getLiquidationPrice(address _positionManager, uint256 _id) public view override returns (uint256) {
        _require(
            IERC165(_positionManager).supportsInterface(type(IPositionManagerV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        PositionLibrary.Position memory position = IPositionManagerV2(_positionManager).getPosition(_id);
        if (position.scaledDebtAmount == 0) return 0;

        uint256 positionDebt = IPositionManagerV2(_positionManager).getPositionDebt(_id);
        return
            PrimexPricingLibrary.getLiquidationPrice(
                address(position.bucket),
                position.positionAsset,
                position.positionAmount,
                positionDebt
            );
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getPositionMaxDecrease(
        IPositionManagerV2 _pm,
        uint256 _id,
        bytes calldata _positionSoldAssetOracleData
    ) public override returns (uint256) {
        PositionLibrary.Position memory position = _pm.getPosition(_id);
        uint256 pairPriceDrop = _pm.priceOracle().getPairPriceDrop(position.positionAsset, address(position.soldAsset));
        uint256 securityBuffer = _pm.securityBuffer();
        uint256 maintenanceBuffer = _pm.maintenanceBuffer();

        uint256 oracleTolerableLimit = _pm.getOracleTolerableLimit(position.positionAsset, address(position.soldAsset));

        uint256 feeBuffer = position.bucket.feeBuffer();
        uint256 positionAmountInBorrowedAsset = PrimexPricingLibrary.getOracleAmountsOut(
            position.positionAsset,
            position.soldAsset,
            position.positionAmount,
            address(_pm.priceOracle()),
            _positionSoldAssetOracleData
        );
        uint256 maxDecrease = (WadRayMath.WAD - securityBuffer)
            .wmul(WadRayMath.WAD - oracleTolerableLimit)
            .wmul(WadRayMath.WAD - pairPriceDrop)
            .wmul(positionAmountInBorrowedAsset)
            .wdiv(feeBuffer.wmul(WadRayMath.WAD + maintenanceBuffer)) -
            position.bucket.getNormalizedVariableDebt().rmul(position.scaledDebtAmount);

        return maxDecrease <= position.depositAmountInSoldAsset ? maxDecrease : position.depositAmountInSoldAsset;
    }

    /**
     * @inheritdoc IPrimexLens
     */
    function getEstimatedMinProtocolFee(
        IPrimexDNSStorageV3.TradingOrderType _tradingOrderType,
        IPositionManagerV2 _pm
    ) public view override returns (uint256) {
        uint256 restrictedGasPrice = PrimexPricingLibrary.calculateRestrictedGasPrice(
            address(_pm.priceOracle()),
            _pm.keeperRewardDistributor()
        );
        IKeeperRewardDistributorStorage.PaymentModel paymentModel = _pm.keeperRewardDistributor().paymentModel();

        uint256 l1CostWei = paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM
            ? ARB_NITRO_ORACLE.getL1BaseFeeEstimate() *
                GAS_FOR_BYTE *
                (_pm.primexDNS().getArbitrumBaseLengthForTradingOrderType(_tradingOrderType) +
                    TRANSACTION_METADATA_BYTES)
            : 0;

        uint256 estimatedMinProtocolFeeInNativeAsset = _pm.primexDNS().averageGasPerAction(_tradingOrderType) *
            restrictedGasPrice +
            l1CostWei;
        return estimatedMinProtocolFeeInNativeAsset;
    }
}
