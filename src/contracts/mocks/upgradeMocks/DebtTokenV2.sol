// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {DebtToken} from "../../DebtToken/DebtToken.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract DebtTokenV2 is IUpgradeInterface, DebtToken {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "DebtTokenV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
