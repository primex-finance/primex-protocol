// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC165Upgradeable, IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ITiersManager} from "../TiersManager/ITiersManager.sol";

import {IDepositManagerStorage, IPrimexDNSV3, IPriceOracleV2, IWhiteBlackList} from "./IDepositManagerStorage.sol";

abstract contract DepositManagerStorage is
    IDepositManagerStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    IAccessControl public override registry;
    IPrimexDNSV3 public override primexDNS;
    IPriceOracleV2 public override priceOracle;
    IWhiteBlackList public override whiteBlackList;

    Deposit[] internal deposits;
    uint256 public override depositIdCounter;

    // mapping from user address to the deposit ids array
    mapping(address => uint256[]) internal userDepositIds;
    // mapping from bucket address to the deposit ids array
    mapping(address => uint256[]) internal bucketDepositIds;

    // mapping from depositId to the index in the deposits array
    mapping(uint256 => uint256) internal idToIndex;
    // mapping from depositId => depositIndexes in the userDepositIds[user] array
    mapping(uint256 => uint256) internal userDepositIndexes;
    // mapping from depositId => depositIndexes in the bucketDepositIds[user] array
    mapping(uint256 => uint256) internal bucketDepositIndexes;

    // Mapping to store interest rates: bucket -> rewardToken -> duration -> interestRate
    mapping(address => mapping(address => mapping(uint256 => uint256))) public override interestRates;

    // Mapping to store max total deposits for each bucket: bucket => amounts
    mapping(address => uint256) public override maxTotalDeposits;

    // the list of possible deposit durations,
    // bucket => rewardTorken => durations
    mapping(address => mapping(address => uint256[])) internal bucketPossibleDurations;

    // True if possibleDurations already contains this duration for a bucket, false otherwise;
    // used to avoid duplicates
    // bucket => rewardTorken => duration => bool
    mapping(address => mapping(address => mapping(uint256 => bool))) public isPossibleDurationInBucket;

    // The list of tokens that can be used as rewards
    // bucket => rewardTokens
    mapping(address => address[]) public bucketRewardTokens;

    // True if rewardTokens already contains this token for a bucket, false otherwise;
    // used to avoid duplicates
    // bucket => rewardToken => bool
    mapping(address => mapping(address => bool)) public isRewardTokenInBucket;

    // True if the token is P-token of any buckets, false otherwise;
    // token => bool
    mapping(address => bool) internal isPToken;
}

abstract contract DepositManagerStorageV2 is DepositManagerStorage {
    ITiersManager public override tierManager;
    uint256 internal magicTierCoefficient;
}

abstract contract DepositManagerStorageV3 is DepositManagerStorageV2 {
    mapping(address => uint256) internal totalRewardAmount;
    mapping(address => uint256) internal totalClaimedReward;
    // deposit id => extended info
    mapping(uint256 => DepositExtendedInfo) internal depositExtInfo;
}
