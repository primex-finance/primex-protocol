// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

interface ICurveCryptoSwapRegistry {
    /* solhint-disable func-name-mixedcase */
    function get_n_coins(address lp) external view returns (uint256);

    function pool_list(uint256 id) external view returns (address);

    function get_coins(address pool) external view returns (address[8] memory);

    function get_pool_from_lp_token(address lp) external view returns (address);

    function get_virtual_price_from_lp_token(address lp) external view returns (uint256);

    function get_gauges(address pool) external view returns (address[10] memory, uint128[10] memory);
}

interface ICurveSwapFactory {
    /* solhint-disable func-name-mixedcase */
    function get_n_coins(address lp) external view returns (uint256);

    function get_coins(address pool) external view returns (address[4] memory);
}
