// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IBonusExecutor} from "../BonusExecutor/IBonusExecutor.sol";

interface IPMXBonusNFTStorage {
    struct NftMetadata {
        address bucket;
        uint256 bonusTypeId;
        uint256 tier;
        address activatedBy; //The bonus is always left to the one who activates it, although the nft token can be transferred to anyone
        string uri;
    }

    function bonusExecutors(uint256) external view returns (IBonusExecutor);
}
