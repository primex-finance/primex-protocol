// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;
import {SpotTradingRewardDistributor} from "../../SpotTradingRewardDistributor/SpotTradingRewardDistributor.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract SpotTradingRewardDistributorV2 is IUpgradeInterface, SpotTradingRewardDistributor {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "SpotTradingRewardDistributorV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
