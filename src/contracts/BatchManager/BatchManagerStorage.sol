// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC165Upgradeable, IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";

import {IBatchManagerStorage} from "./IBatchManagerStorage.sol";

abstract contract BatchManagerStorage is
    IBatchManagerStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    IPositionManagerV2 public override positionManager;
    IPriceOracleV2 public override priceOracle;
    IWhiteBlackList public override whiteBlackList;
    address public override registry;
    uint256 public override gasPerPosition;
    uint256 public override gasPerBatch;
}
