// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IBucketEvents {
    event WithdrawFromAave(address indexed pool, uint256 amount);
    event Withdraw(address indexed withdrawer, address indexed borrowAssetReceiver, uint256 amount);
    event TopUpTreasury(address indexed sender, uint256 amount);
}
