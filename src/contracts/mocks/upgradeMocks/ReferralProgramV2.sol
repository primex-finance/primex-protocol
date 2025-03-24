// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ReferralProgram} from "../../ReferralProgram/ReferralProgram.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract ReferralProgramV2 is IUpgradeInterface, ReferralProgram {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "ReferralProgramV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
