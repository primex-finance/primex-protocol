// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {InterestIncreaser} from "../../BonusExecutor/InterestIncreaser.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract InterestIncreaserV2 is IUpgradeInterface, InterestIncreaser {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "InterestIncreaserV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
