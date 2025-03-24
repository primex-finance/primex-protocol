// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "../libraries/Errors.sol";

import {IActivityRewardDistributorStorage, IERC20, IPrimexDNSV3, ITraderBalanceVault} from "./IActivityRewardDistributorStorage.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

abstract contract ActivityRewardDistributorStorage is
    IActivityRewardDistributorStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    IERC20 public override pmx;
    IPrimexDNSV3 public override dns;
    address public override registry;
    address public override treasury;
    ITraderBalanceVault public override traderBalanceVault;
    mapping(address => BucketInfo[2]) public buckets;
    IWhiteBlackList internal whiteBlackList;
}
