// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

interface ICurvePool {
    // solhint-disable-next-line func-name-mixedcase
    function get_virtual_price() external view returns (uint256);
}
