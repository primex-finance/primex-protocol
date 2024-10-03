// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {IAccessControl} from "./ITreasuryStorage.sol";
import {ITreasuryStorage} from "./ITreasuryStorage.sol";

abstract contract TreasuryStorage is
    ITreasuryStorage,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable
{
    // user=> token => SpendingInfo
    mapping(address => mapping(address => SpendingInfo)) public override spenders;
    uint256 public override initialTimestamp;
    IAccessControl public override registry;
}
