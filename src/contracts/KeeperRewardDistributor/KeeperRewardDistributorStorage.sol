// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "../libraries/Errors.sol";

import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IKeeperRewardDistributorStorage, IKeeperRewardDistributorStorageV2} from "./IKeeperRewardDistributorStorage.sol";

abstract contract KeeperRewardDistributorStorage is
    IKeeperRewardDistributorStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    address public override priceOracle;
    address public override registry;
    address public override pmx;
    address payable public override treasury;
    uint256 public override pmxPartInReward;
    uint256 public override nativePartInReward;
    /// @custom:oz-renamed-from positionSizeCoefficientA
    uint256 public override positionSizeCoefficient;
    int256 public override positionSizeCoefficientB;
    uint256 public override additionalGas;
    uint256 public override defaultMaxGasPrice;
    uint256 public override oracleGasPriceTolerance;
    PaymentModel public override paymentModel;
    mapping(address => KeeperBalance) public override keeperBalance;
    KeeperBalance public override totalBalance;
    mapping(KeeperActionType => KeeperActionRewardConfig) public override maxGasPerPosition;
    mapping(KeeperCallingMethod => DataLengthRestrictions) public override dataLengthRestrictions;
    mapping(DecreasingReason => uint256) public override decreasingGasByReason;
    IWhiteBlackList internal whiteBlackList;
}

abstract contract KeeperRewardDistributorStorageV2 is
    IKeeperRewardDistributorStorageV2,
    KeeperRewardDistributorStorage
{
    /// @custom:oz-retyped-from int256
    uint256 public override minPositionSizeMultiplier;
    uint256 public override optimisticGasCoefficient;
}
