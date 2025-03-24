// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {OrallyStructs} from "@orally-network/solidity-sdk/OrallyStructs.sol";

contract OrallyVerifierOracle {
    using ECDSA for bytes32;

    // Mapping to track authorized reporters who can sign and submit price feeds (Sybil permissionless wallet)
    mapping(address => bool) public reporters;

    // Mapping to store the latest price feeds by pair ID
    mapping(string => OrallyStructs.PriceFeed) public priceFeeds;
    // Mapping to store the latest custom number data by feed ID
    mapping(string => OrallyStructs.CustomNumber) public customNumbers;
    // Mapping to store the latest custom string data by feed ID
    mapping(string => OrallyStructs.CustomString) public customStrings;

    // solhint-disable-next-line comprehensive-interface
    function getPriceFeed(string memory _pairId) external view returns (OrallyStructs.PriceFeed memory) {
        return priceFeeds[_pairId];
    }

    function _storePriceFeed(
        OrallyStructs.PriceFeed memory _priceFeed
    ) internal returns (OrallyStructs.PriceFeed memory) {
        priceFeeds[_priceFeed.pairId] = _priceFeed;
        return _priceFeed;
    }

    // solhint-disable-next-line comprehensive-interface
    function updatePriceFeed(bytes memory _data) external returns (OrallyStructs.PriceFeed memory) {
        return _storePriceFeed(abi.decode(_data, (OrallyStructs.PriceFeed)));
    }
}
