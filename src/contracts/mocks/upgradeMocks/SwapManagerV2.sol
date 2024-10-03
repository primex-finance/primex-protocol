// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {SwapManager} from "../../SwapManager/SwapManager.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract SwapManagerV2 is IUpgradeInterface, SwapManager {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "SwapManagerV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
