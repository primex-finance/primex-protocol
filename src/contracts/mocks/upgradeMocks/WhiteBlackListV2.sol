// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;
import {WhiteBlackList} from "../../WhiteBlackList/WhiteBlackList/WhiteBlackList.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract WhiteBlackListV2 is IUpgradeInterface, WhiteBlackList {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "WhiteBlackListV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
