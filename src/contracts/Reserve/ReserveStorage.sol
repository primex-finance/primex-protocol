// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IReserveStorage} from "./IReserveStorage.sol";

abstract contract ReserveStorage is
    IReserveStorage,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable
{
    IPrimexDNSV3 internal dns;
    address internal registry;

    // map pToken address to its transfer restrictions
    mapping(address => TransferRestrictions) public override transferRestrictions;
}
