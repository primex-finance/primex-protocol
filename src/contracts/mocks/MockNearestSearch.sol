// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {FeeExecutor} from "../BonusExecutor/FeeExecutor.sol";
import {IPMXBonusNFT} from "../PMXBonusNFT/IPMXBonusNFT.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IMockNearestSearch} from "./mocksInterfaces/IMockNearestSearch.sol";

contract MockNearestSearch is IMockNearestSearch, FeeExecutor {
    function initialize(
        IPMXBonusNFT _nft,
        address _registry,
        address _primexDNS,
        IWhiteBlackList _whiteBlackList
    ) external override initializer {
        __FeeExecutor_init(_nft, _registry, _primexDNS, _whiteBlackList);
    }

    function setIndexes(uint256[] memory _timestamps, uint256[] memory _indexes, address _bucket) external override {
        for (uint256 i; i < _timestamps.length; i++) {
            indexes[_bucket][_timestamps[i]] = _indexes[i];
        }
    }

    function activateBonus(uint256, uint256, address, address) external pure override {}

    function updateBonus(uint256) external pure override {}

    function claim(uint256, uint256) external pure override {}

    function searchNearestIndex(
        uint256 _bonusDeadline,
        uint256[] memory _timetamps,
        uint256 _currentIndex,
        address _bucket
    ) public override returns (uint256) {
        updatedTimestamps[_bucket] = _timetamps;
        return _searchApproxIndex(_bonusDeadline, _currentIndex, _bucket);
    }

    function updateBonus(address, uint256, address, uint256) public pure override {}

    function getAccumulatedAmount(address, uint256) public pure override returns (uint256) {}
}
