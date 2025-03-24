// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {IPMXBonusNFT} from "./IPMXBonusNFT.sol";
import {IBonusExecutor} from "../BonusExecutor/IBonusExecutor.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPMXBonusNFTStorage} from "./IPMXBonusNFTStorage.sol";

abstract contract PMXBonusNFTStorage is IPMXBonusNFTStorage, ERC721EnumerableUpgradeable, PausableUpgradeable {
    IPrimexDNSV3 public primexDNS;
    address public registry;
    mapping(uint256 => uint256) public idToIndex;
    // Mapping from bonus type id to address of its executor
    mapping(uint256 => IBonusExecutor) public override bonusExecutors;
    uint256 public chainId;
    NftMetadata[] internal nftList;
    mapping(uint256 => string[]) internal idToURIs;
    mapping(uint256 => bool) internal isBlocked;
    IWhiteBlackList internal whiteBlackList;
}
