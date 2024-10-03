// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {Bucket} from "../../Bucket/Bucket.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract BucketV2 is IUpgradeInterface, Bucket {
    uint256 public value;

    function testUpgrade() external pure override returns (string memory) {
        return "BucketV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
