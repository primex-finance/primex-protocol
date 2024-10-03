// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {FeeDecreaser} from "../../BonusExecutor/FeeDecreaser.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract FeeDecreaserV2 is IUpgradeInterface, FeeDecreaser {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "FeeDecreaserV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
