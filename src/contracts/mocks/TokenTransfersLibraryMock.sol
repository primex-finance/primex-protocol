// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

library TokenTransfersLibraryMock {
    function doTransferIn(address, address, uint256) public pure returns (uint256) {}

    function doTransferFromTo(address, address, address, uint256) public pure returns (uint256) {}

    function doTransferOut(address, address, uint256) public pure {}
}
