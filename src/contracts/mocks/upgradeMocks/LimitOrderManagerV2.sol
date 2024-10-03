// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;
import {LimitOrderManager} from "../../LimitOrderManager/LimitOrderManager.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract LimitOrderManagerV2 is IUpgradeInterface, LimitOrderManager {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "LimitOrderManagerV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
