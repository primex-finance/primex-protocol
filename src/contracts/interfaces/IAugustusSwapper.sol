// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IAugustusSwapper {
    function getTokenTransferProxy() external view returns (address);
}
