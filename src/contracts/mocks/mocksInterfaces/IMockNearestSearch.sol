// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPMXBonusNFT} from "../../PMXBonusNFT/IPMXBonusNFT.sol";
import {IWhiteBlackList} from "../../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

interface IMockNearestSearch {
    function setIndexes(uint256[] memory _timestamps, uint256[] memory _indexes, address _bucket) external;

    function searchNearestIndex(
        uint256 _bonusDeadline,
        uint256[] memory _timetamps,
        uint256 _currentIndex,
        address _bucket
    ) external returns (uint256);
}
