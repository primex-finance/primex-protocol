// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {LiquidityMiningRewardDistributor} from "../../LiquidityMiningRewardDistributor/LiquidityMiningRewardDistributor.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract LiquidityMiningRewardDistributorV2 is IUpgradeInterface, LiquidityMiningRewardDistributor {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "LiquidityMiningRewardDistributorV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
