// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;
import {PositionManager} from "../../PositionManager/PositionManager.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract PositionManagerV2 is IUpgradeInterface, PositionManager {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "PositionManagerV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
