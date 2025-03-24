// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import "../libraries/Errors.sol";

import {IPositionManagerStorage, IPositionManagerStorageV2} from "./IPositionManagerStorage.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {ISpotTradingRewardDistributorV2} from "../SpotTradingRewardDistributor/ISpotTradingRewardDistributor.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

abstract contract PositionManagerStorage is
    IPositionManagerStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    // Mapping from asset sell to mapping of asset buy with max amount in asset buy
    mapping(address => mapping(address => uint256)) public override maxPositionSize;

    //The oracleTolerableLimit is the percentage by which a deviation from the oracle price is allowed.
    //This means that the dex amount out must be greater than oracle amount out * (100% - oracleTolerableLimit)
    //Specified in the WAD format: 1e17 = 10%, 1e18 = 100% and so on

    //The defaultOracleTolerableLimit this is the oracleTolerableLimit that is returned when there is
    //no set the oracleTolerableLimit for a specific pair of asset
    uint256 public override defaultOracleTolerableLimit;

    // Buffer security parameter, which characterizes additional price drop, occurs due to some unexpected events
    // Specified in the WAD format: 1e17 = 0.1, 5e17 = 0.5 and so on
    uint256 public override securityBuffer;

    // Additional parameter is needed to avoid immediate liquidation when Trader choses maximal leverage.
    // Specified in the WAD format, 0 < maintenanceBuffer < 1e18
    uint256 public override maintenanceBuffer;

    // Mapping from asset A to mapping of asset B with the oracleTolerableLimit
    mapping(address => mapping(address => uint256)) internal oracleTolerableLimits;

    uint256 public oracleTolerableLimitMultiplier;

    PositionLibrary.Position[] internal positions;
    uint256 public override positionsId;
    // mapping from trader address to the position ids array
    mapping(address => uint256[]) public override traderPositionIds;
    // mapping from bucket address to the position ids array
    mapping(address => uint256[]) public override bucketPositionIds;
    // mapping from position to close conditions
    mapping(uint256 => LimitOrderLibrary.Condition[]) internal closeConditions;

    IAccessControl public override registry;
    ITraderBalanceVault public override traderBalanceVault;
    IPrimexDNSV3 public override primexDNS;
    IPriceOracleV2 public override priceOracle;
    IKeeperRewardDistributorV3 public override keeperRewardDistributor;
    ISpotTradingRewardDistributorV2 public override spotTradingRewardDistributor;

    // minimum position size allowed
    uint256 public override minPositionSize;
    // ERC20 token for minimum position size
    address public override minPositionAsset;

    // mapping from positionId to the index in the positions array
    mapping(uint256 => uint256) internal positionIndexes;
    // mapping from positionId to the index in the traderPositionIds[trader] array
    //NOTE: positionId is unique for all traders hence we can put everything in one mapping
    mapping(uint256 => uint256) internal traderPositionIndexes;
    // mapping from positionId to the index in the bucketPositionIds[bucket] array
    mapping(uint256 => uint256) internal bucketPositionIndexes;
    IWhiteBlackList internal whiteBlackList;
}

abstract contract PositionManagerStorageV2 is IPositionManagerStorageV2, PositionManagerStorage {
    address public override positionManagerExtension;
}
