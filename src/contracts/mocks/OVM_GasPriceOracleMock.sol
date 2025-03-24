// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

// solhint-disable-next-line contract-name-camelcase
contract OVM_GasPriceOracleMock {
    // solhint-disable-next-line comprehensive-interface
    function getL1FeeUpperBound(uint256 _unsignedTxSize) external view returns (uint256) {
        return _unsignedTxSize * 0.5 gwei;
    }
}
