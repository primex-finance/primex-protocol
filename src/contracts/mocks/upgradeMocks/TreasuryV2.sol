// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;
import {Treasury} from "../../Treasury/Treasury.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract TreasuryV2 is IUpgradeInterface, Treasury {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "TreasuryV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
