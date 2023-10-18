// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface ICurvePool {
    // solhint-disable func-name-mixedcase
    // solhint-disable var-name-mixedcase
    function add_liquidity(uint256[3] memory amounts, uint256 min_mint_amount) external;

    function remove_liquidity(uint256 _amount, uint256[3] memory min_amounts) external;

    function A() external view returns (uint256);

    function token() external view returns (address);

    function fee() external view returns (uint256);

    function balances(uint256 _i) external view returns (uint256);

    function coins(uint256 _i) external view returns (address);

    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}
