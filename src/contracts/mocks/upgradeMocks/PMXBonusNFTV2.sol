// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {PMXBonusNFT} from "../../PMXBonusNFT/PMXBonusNFT.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract PMXBonusNFTV2 is IUpgradeInterface, PMXBonusNFT {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "PMXBonusNFTV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
