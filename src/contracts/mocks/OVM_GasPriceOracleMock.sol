// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

// solhint-disable-next-line contract-name-camelcase
contract OVM_GasPriceOracleMock {
    // solhint-disable-next-line comprehensive-interface
    function l1BaseFee() public pure returns (uint256) {
        return 3000000000;
    }

    // solhint-disable-next-line comprehensive-interface
    function overhead() public pure returns (uint256) {
        return 188;
    }

    // solhint-disable-next-line comprehensive-interface
    function scalar() public pure returns (uint256) {
        return 684000;
    }
}
