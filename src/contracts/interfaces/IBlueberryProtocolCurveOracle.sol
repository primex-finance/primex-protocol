// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IBlueberryProtocolCurveOracle {
    struct TokenInfo {
        address pool;
        address[] tokens;
        uint256 registryIndex;
    }

    function getPrice(address token) external view returns (uint256);

    function getTokenInfo(address pair) external view returns (TokenInfo memory);
}
