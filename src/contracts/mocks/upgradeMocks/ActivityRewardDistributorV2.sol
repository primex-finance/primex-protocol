// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ActivityRewardDistributor} from "../../ActivityRewardDistributor/ActivityRewardDistributor.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract ActivityRewardDistributorV2 is IUpgradeInterface, ActivityRewardDistributor {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "ActivityRewardDistributorV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
