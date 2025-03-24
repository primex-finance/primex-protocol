// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ITraderBalanceVaultV2} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPrimexNFT} from "../PrimexNFT/IPrimexNFT.sol";

import {ITiersManagerStorage} from "./ITiersManagerStorage.sol";

abstract contract TiersManagerStorage is ITiersManagerStorage, ERC165Upgradeable {
    IAccessControl public override registry;
    ITraderBalanceVaultV2 public override traderBalanceVault;
    IPrimexNFT public override lendingNFT;
    IPrimexNFT public override tradingNFT;
    IPrimexNFT public override farmingNFT;

    address public override pmx;
    //tier => qty of PMX tokens
    mapping(uint256 => uint256) public override tiersThresholds;
    uint256[] internal tiers;
}
