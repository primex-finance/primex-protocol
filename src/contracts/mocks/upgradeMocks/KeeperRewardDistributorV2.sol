// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {KeeperRewardDistributor} from "../../KeeperRewardDistributor/KeeperRewardDistributor.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract KeeperRewardDistributorV2 is IUpgradeInterface, KeeperRewardDistributor {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "KeeperRewardDistributorV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
