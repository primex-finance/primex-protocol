// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {EPMXToken} from "../../EPMXToken.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract EPMXTokenV2 is IUpgradeInterface, EPMXToken {
    uint256 public value;

    constructor(address _recipient, address _registry) EPMXToken(_recipient, _registry) {}

    function testUpgrade() external pure override returns (string memory) {
        return "EPMXTokenV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
