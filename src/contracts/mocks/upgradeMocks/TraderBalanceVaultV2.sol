// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {TraderBalanceVault} from "../../TraderBalanceVault/TraderBalanceVault.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract TraderBalanceVaultV2 is IUpgradeInterface, TraderBalanceVault {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "TraderBalanceVaultV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
