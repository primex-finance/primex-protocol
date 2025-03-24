// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IPToken} from "../PToken/IPToken.sol";
import {IDebtToken} from "../DebtToken/IDebtToken.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IReserve} from "../Reserve/IReserve.sol";
import {ILiquidityMiningRewardDistributor} from "../LiquidityMiningRewardDistributor/ILiquidityMiningRewardDistributor.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IInterestRateStrategy} from "../interfaces/IInterestRateStrategy.sol";

interface IBucketStorage {
    /**
     * @dev Parameters of liquidity mining
     */
    struct LiquidityMiningParams {
        ILiquidityMiningRewardDistributor liquidityMiningRewardDistributor;
        bool isBucketLaunched;
        uint256 accumulatingAmount;
        uint256 deadlineTimestamp;
        uint256 stabilizationDuration;
        uint256 stabilizationEndTimestamp;
        uint256 maxAmountPerUser; // if maxAmountPerUser is >= accumulatingAmount then check on maxAmountPerUser is off
        // Constant max variables are used for calculating users' points.
        // These intervals are used for fair distribution of points among Lenders.
        // Lenders who brought liquidity earlier receive more than the ones who deposited later.
        // To get maximum points per token, a Lender should deposit immediately after the Bucket deployment.
        uint256 maxDuration;
        uint256 maxStabilizationEndTimestamp;
    }
    //                                        1. Corner case of bucket launch
    //
    //                                              maxDuration
    //       ------------------------------------------------------------------------------------------------
    //      |                                                                                               |
    //      |                                                                        stabilizationDuration  |
    //      |                                                                      -------------------------|
    //      |                                                                     | bucket launch           |
    //   +--+---------------------------------------------------------------------+-------------------------+------> time
    //      bucket deploy                                                         deadlineTimestamp         maxStabilizationEndTimestamp
    //                                                                                                       (=stabilizationEndTimestamp here)
    //                                  (corner case of bucket launch)

    //                                        2. One of cases of bucket launch
    //
    //      |                     stabilizationDuration
    //      |                   -------------------------
    //      |                  |                         |
    //   +--+------------------+-------------------------+------------------------+-------------------------+------> time
    //      bucket deploy      bucket launch            stabilizationEndTimestamp  deadlineTimestamp        maxStabilizationEndTimestamp
    //                                                                            (after deadline bucket can't be launched)

    struct Asset {
        uint256 index;
        bool isSupported;
    }

    function liquidityIndex() external view returns (uint128);

    function variableBorrowIndex() external returns (uint128);

    function name() external view returns (string memory);

    function registry() external view returns (address);

    function positionManager() external view returns (IPositionManagerV2);

    function reserve() external view returns (IReserve);

    function permanentLossScaled() external view returns (uint256);

    function pToken() external view returns (IPToken);

    function debtToken() external view returns (IDebtToken);

    function borrowedAsset() external view returns (IERC20Metadata);

    function feeBuffer() external view returns (uint256);

    function withdrawalFeeRate() external view returns (uint256);

    /**
     * @notice bar = borrowing annual rate (originally APR)
     */
    function bar() external view returns (uint128);

    /**
     * @notice lar = lending annual rate (originally APY)
     */
    function lar() external view returns (uint128);

    function interestRateStrategy() external view returns (IInterestRateStrategy);

    function estimatedBar() external view returns (uint128);

    function estimatedLar() external view returns (uint128);

    function allowedAssets(address _asset) external view returns (uint256, bool);

    function whiteBlackList() external view returns (IWhiteBlackList);

    function maxTotalDeposit() external view returns (uint256);
}

interface IBucketStorageV2 {
    function bucketExtension() external view returns (address);
}
