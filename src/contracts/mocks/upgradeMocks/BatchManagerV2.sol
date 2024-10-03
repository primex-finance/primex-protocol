// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {BatchManager} from "../../BatchManager/BatchManager.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract BatchManagerV2 is IUpgradeInterface, BatchManager {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "BatchManagerV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
