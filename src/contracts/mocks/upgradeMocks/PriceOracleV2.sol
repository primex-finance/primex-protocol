// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;
import {PriceOracle} from "../../PriceOracle/PriceOracle.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract PriceOracleV2 is IUpgradeInterface, PriceOracle {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "PriceOracleV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
