// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {PToken} from "../../PToken/PToken.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract PTokenV2 is IUpgradeInterface, PToken {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "PTokenV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
