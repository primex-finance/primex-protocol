// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";

import {IPositionManager} from "../PositionManager/IPositionManager.sol";
import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";
import {IPriceOracle} from "../PriceOracle/IPriceOracle.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IBucket} from "../Bucket/IBucket.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {IPausable} from "./IPausable.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

interface IBatchManager is IPausable {
    struct CloseBatchPositionsVars {
        uint256[] ids;
        address[] traders;
        uint256[] positionAmounts;
        uint256[] debts;
        uint256[] depositsDecrease;
        uint256[] decreasingCounter;
        IKeeperRewardDistributorStorage.KeeperActionType actionType;
        uint256 numberOfPositions;
        uint256 oracleTolerableLimit;
        uint256 securityBuffer;
        IPositionManager positionManager;
        IPrimexDNS primexDNS;
        IPriceOracle priceOracle;
        ITraderBalanceVault traderBalanceVault;
        uint256 pairPriceDrop;
        LimitOrderLibrary.Condition[] closeConditions;
        bool borrowedAmountIsNotZero;
        address bucket;
        uint256 totalCloseAmount;
        uint256 uncoveredAmount;
        uint256 totalDebt;
        address adapter;
        uint256[] returnedToTraders;
        uint256 amountToReturn;
        uint256 borrowedAssetAmountOut;
        uint256 normalizedVariableDebt;
        uint256 permanentLoss;
        uint256[] shareOfBorrowedAssetAmount;
        bool isLiquidation;
    }

    /**
     * @notice Closes positions in batch
     * @param  _ids  An array of IDs of the positions to be closed.
     * @param  _routes  An array of routes for swap.
     * @param  _positionAsset  The address of the position asset.
     * @param  _depositedAsset  The address of the borrowed asset.
     * @param  _bucket  The instance of the bucket.
     * @param  _conditionIndexes  The array of the indexes of close conditions for each position.
     * @param  _closeReason  The reason for closing positions.
     */
    function closeBatchPositions(
        uint256[] calldata _ids,
        PrimexPricingLibrary.Route[] calldata _routes,
        address _positionAsset,
        address _depositedAsset,
        IBucket _bucket,
        uint256[] calldata _conditionIndexes,
        PositionLibrary.CloseReason _closeReason
    ) external;

    /**
     * @notice Retrieves the address of PositionManager contract.
     */
    function positionManager() external view returns (IPositionManager);

    /**
     * @notice Retrieves the address of PriceOracle contract.
     */
    function priceOracle() external view returns (IPriceOracle);

    /**
     * @notice Retrieves the address of WhiteBlackList contract.
     */
    function whiteBlackList() external view returns (IWhiteBlackList);

    /**
     * @notice Retrieves the address of Registry contract.
     */
    function registry() external view returns (address);
}
