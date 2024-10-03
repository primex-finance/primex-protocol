// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IUpgradeInterface {
    function testUpgrade() external pure returns (string memory);

    function setValue(uint256 _value) external;
}
