// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../libraries/Errors.sol";

import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {ILiquidityMiningRewardDistributorStorage, IPrimexDNSV3, ITraderBalanceVault, IERC20} from "./ILiquidityMiningRewardDistributorStorage.sol";

contract LiquidityMiningRewardDistributorStorage is
    ILiquidityMiningRewardDistributorStorage,
    PausableUpgradeable,
    ERC165Upgradeable,
    ReentrancyGuardUpgradeable
{
    IPrimexDNSV3 public override primexDNS;
    IERC20 public override pmx;
    ITraderBalanceVault public override traderBalanceVault;
    address public override registry;
    address public treasury;
    uint256 public override reinvestmentRate;
    uint256 public override reinvestmentDuration;
    mapping(address => mapping(string => uint256)) public override extraRewards;
    IWhiteBlackList internal whiteBlackList;
    // internal because we can't create getter for storage mapping inside structure
    // Mapping from bucket name => BucketInfo
    mapping(string => BucketInfo) internal buckets;
}
