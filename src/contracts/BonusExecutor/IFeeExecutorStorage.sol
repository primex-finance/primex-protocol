// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IBucketV3} from "../Bucket/IBucket.sol";

interface IFeeExecutorStorage {
    struct ActivatedBonus {
        uint256 nftId;
        IBucketV3 bucket;
        uint256 percent;
        uint256 maxAmount;
        uint256 accumulatedAmount;
        uint256 lastUpdatedIndex;
        uint256 deadline;
        //if we allow to claim funds before the end of the bonus
        uint256 claimedAmount;
    }

    struct NFTBonusParams {
        uint256 percent;
        uint256 maxAmount;
        uint256 duration;
    }
}
