// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC165Upgradeable, IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";

import {IFlashLoanManagerStorage} from "./IFlashLoanManagerStorage.sol";

abstract contract FlashLoanManagerStorage is
    IFlashLoanManagerStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    IAccessControl public override registry;
    IPrimexDNS public override primexDNS;
    IWhiteBlackList public whiteBlackList;
    uint256 public override flashLoanFeeRate;
    uint256 public override flashLoanProtocolRate;
}
