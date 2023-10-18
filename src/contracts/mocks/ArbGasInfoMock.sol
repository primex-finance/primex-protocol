// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

contract ArbGasInfoMock {
    uint256 public l1GasPrice;

    // solhint-disable-next-line comprehensive-interface
    function getL1BaseFeeEstimate() external view returns (uint256) {
        return l1GasPrice;
    }

    // solhint-disable-next-line comprehensive-interface
    function setL1BaseFeeEstimate(uint256 _newL1GasPrice) external {
        l1GasPrice = _newL1GasPrice;
    }
}
