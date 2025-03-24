// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IFeeExecutorStorage} from "./IFeeExecutorStorage.sol";

abstract contract FeeExecutorStorage is IFeeExecutorStorage {
    address public primexDNS;

    // Mapping from bucket to tier's bonus
    mapping(address => mapping(uint256 => NFTBonusParams)) public tierBonus;
    // Mapping (bucket-address => mapping (timestamp => corresponding-debt/income-index))
    mapping(address => mapping(uint256 => uint256)) public indexes;
    // Mapping (bucket-address => updatedTimestamps-of-this-bucket)
    mapping(address => uint256[]) public updatedTimestamps;
    // Mapping from owner to list of buckets with user bonuses
    mapping(address => mapping(address => ActivatedBonus)) internal bonuses;
}
