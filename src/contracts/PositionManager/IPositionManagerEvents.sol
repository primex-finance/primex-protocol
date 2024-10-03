// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";

interface IPositionManagerEvents {
    event SetMaxPositionSize(address token0, address token1, uint256 amountInToken0, uint256 amountInToken1);
    event SetDefaultOracleTolerableLimit(uint256 indexed oracleTolerableLimit);
    event SecurityBufferChanged(uint256 indexed securityBuffer);
    event MaintenanceBufferChanged(uint256 indexed maintenanceBuffer);
    event SetOracleTolerableLimit(address indexed assetA, address indexed assetB, uint256 oracleTolerableLimit);
    event KeeperRewardDistributorChanged(address indexed _keeperRewardDistributor);
    event OracleTolerableLimitMultiplierChanged(uint256 indexed newMultiplier);

    event OpenPosition(
        uint256 indexed positionId,
        address indexed trader,
        address indexed openedBy,
        PositionLibrary.Position position,
        uint256 entryPrice,
        uint256 leverage,
        LimitOrderLibrary.Condition[] closeConditions
    );

    event PartialClosePosition(
        uint256 indexed positionId,
        address indexed trader,
        address bucketAddress,
        address soldAsset,
        address positionAsset,
        uint256 decreasePositionAmount,
        uint256 depositedAmount,
        uint256 scaledDebtAmount,
        int256 profit,
        uint256 positionDebt,
        uint256 amountOut
    );

    event DecreaseDeposit(
        uint256 indexed positionId,
        address indexed trader,
        uint256 depositDelta,
        uint256 scaledDebtAmount
    );

    event UpdatePositionConditions(
        uint256 indexed positionId,
        address indexed trader,
        LimitOrderLibrary.Condition[] closeConditions
    );
}
