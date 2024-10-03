// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {PrimexDNS} from "../../PrimexDNS/PrimexDNS.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract PrimexDNSV2 is IUpgradeInterface, PrimexDNS {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "PrimexDNSV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
