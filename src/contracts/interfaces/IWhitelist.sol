// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IWhitelist {
    event WhitelistedAddressAdded(address indexed addr);
    event WhitelistedAddressRemoved(address indexed addr);

    function initialize(address _registry) external;

    function addAddressToWhitelist(address _address) external;

    function addAddressesToWhitelist(address[] calldata _addresses) external;

    function removeAddressFromWhitelist(address _address) external;

    function removeAddressesFromWhitelist(address[] calldata _addresses) external;

    function isWhitelisted(address _address) external view returns (bool);

    function registry() external view returns (address);
}
