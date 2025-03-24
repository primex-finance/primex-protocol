// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPrimexNFTStorage} from "./IPrimexNFTStorage.sol";

abstract contract PrimexNFTStorage is IPrimexNFTStorage, ERC721EnumerableUpgradeable {
    IAccessControl public override registry;
    mapping(uint256 => uint256) public override idToDeadLine;
    string internal baseURI;
}
