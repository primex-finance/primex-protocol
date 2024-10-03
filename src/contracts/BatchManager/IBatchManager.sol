// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";

import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {IPausable} from "../interfaces/IPausable.sol";
import {IBatchManagerStorage} from "./IBatchManagerStorage.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";

interface IBatchManager is IBatchManagerStorage, IPausable {
    struct CloseBatchPositionsVars {
        uint256[] ids;
        address[] traders;
        address[] feeTokens;
        uint256[] positionAmounts;
        uint256[] debts;
        uint256[] depositsDecrease;
        uint256[] decreasingCounter;
        IKeeperRewardDistributorStorage.KeeperActionType actionType;
        uint256 numberOfPositions;
        uint256 oracleTolerableLimit;
        uint256 securityBuffer;
        IPositionManagerV2 positionManager;
        IPrimexDNSV3 primexDNS;
        IPriceOracleV2 priceOracle;
        IKeeperRewardDistributorV3 keeperRewardDistributor;
        ITraderBalanceVault traderBalanceVault;
        uint256 pairPriceDrop;
        LimitOrderLibrary.Condition[] closeConditions;
        bool borrowedAmountIsNotZero;
        address bucket;
        uint256 totalCloseAmount;
        uint256 uncoveredAmount;
        uint256 totalDebt;
        address payable adapter;
        uint256[] returnedToTraders;
        uint256 amountToReturn;
        uint256 positionAmountInBorrowedAsset;
        uint256 normalizedVariableDebt;
        uint256 permanentLoss;
        uint256[] shareOfBorrowedAssetAmount;
        bool isLiquidation;
        uint256[] feeInPositionAsset;
        uint256[] feeInPmx;
        uint256 totalFeeInPositionAsset;
    }

    struct CloseBatchPositionsLocalData {
        uint256 feeBuffer;
        uint256[] positionAmountInBorrowedAsset;
        uint256 exchangeRate;
        uint256 managerType;
        address cm;
        uint256 multiplierPositionAsset;
        uint256 multiplierBorrowedAsset;
    }

    event ChangeGasPerPosition(uint256 gasPerPosition);
    event ChangeGasPerBatch(uint256 gasPerBatch);

    /**
     * @notice Initializes the contract with the specified parameters.
     * @param _positionManager The address of the PositionManager contract.
     * @param _priceOracle The address of the PriceOracle contract.
     * @param _whiteBlackList The address of the WhiteBlackList contract.
     * @param _registry The address of the PrimexRegistry contract.
     * @param _gasPerPosition The gas amount per position.
     * @param _gasPerBatch The gas amount per batch.
     */
    function initialize(
        address _positionManager,
        address _priceOracle,
        address _whiteBlackList,
        address _registry,
        uint256 _gasPerPosition,
        uint256 _gasPerBatch
    ) external;

    /**
     * @notice Closes positions in batch
     * @param  _ids  An array of IDs of the positions to be closed.
     * @param  _megaRoutes  An array of routes for swap.
     * @param  _positionAsset  The address of the position asset.
     * @param  _soldAsset  The address of the borrowed asset.
     * @param  _bucket  The instance of the bucket.
     * @param  _conditionIndexes  The array of the indexes of close conditions for each position.
     * @param  _closeReason  The reason for closing positions.
     */
    function closeBatchPositions(
        uint256[] calldata _ids,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        address _positionAsset,
        address _soldAsset,
        IBucketV3 _bucket,
        uint256[] calldata _conditionIndexes,
        PositionLibrary.CloseReason _closeReason,
        bytes memory _positionSoldAssetOracleData,
        bytes calldata _nativePmxOracleData,
        bytes calldata _nativePositionAssetOracleData,
        bytes calldata _positionNativeAssetOracleData,
        bytes calldata _pmxPositionAssetOracleData,
        bytes[] calldata _pullOracleData
    ) external payable;

    /**
     * @notice Set the gas amount per position.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     */
    function setGasPerPosition(uint256 _gasPerPosition) external;

    /**
     * @notice Set the gas amount per batch.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     */
    function setGasPerBatch(uint256 _gasPerBatch) external;
}
