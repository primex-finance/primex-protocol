// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;
import {Reserve} from "../../Reserve/Reserve.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract ReserveV2 is IUpgradeInterface, Reserve {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "ReserveV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
