// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {ISpotTradingRewardDistributorStorage} from "./ISpotTradingRewardDistributorStorage.sol";

abstract contract SpotTradingRewardDistributorStorage is
    ISpotTradingRewardDistributorStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    address public override registry;
    address public override dns;
    uint256 public override periodDuration;
    uint256 public override initialPeriodTimestamp;
    uint256 public override rewardPerPeriod;
    address public override pmx;
    address public override priceOracle;
    address public override treasury;
    address payable public override traderBalanceVault;
    uint256 public override undistributedPMX;

    //map period number to period info
    mapping(uint256 => PeriodInfo) public override periods;

    //map trader to array of period numbers with her activity
    mapping(address => uint256[]) internal periodsWithTraderActivity;
}
