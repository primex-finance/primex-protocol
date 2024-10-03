// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {DexAdapter} from "../../DexAdapter.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract DexAdapterV2 is IUpgradeInterface, DexAdapter {
    uint256 public value;

    // solhint-disable-next-line var-name-mixedcase
    constructor(address _registry, address _WNAtive) DexAdapter(_registry, _WNAtive) {}

    function testUpgrade() external pure override returns (string memory) {
        return "DexAdapterV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
