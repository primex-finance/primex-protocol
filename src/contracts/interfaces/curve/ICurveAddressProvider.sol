// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

interface ICurveAddressProvider {
    /* solhint-disable func-name-mixedcase */
    /* solhint-disable var-name-mixedcase */
    function get_registry() external view returns (address);

    function get_id_info(
        uint256
    )
        external
        view
        returns (address addr, bool is_active, uint256 version, uint256 last_modified, string memory description);

    function get_address(uint256 id) external view returns (address);
}
