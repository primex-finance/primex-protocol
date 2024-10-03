// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import {IBucket, IBucketV3} from "../Bucket/IBucket.sol";
import {IFeeExecutor} from "../BonusExecutor/IFeeExecutor.sol";
import {IActivityRewardDistributor} from "../ActivityRewardDistributor/IActivityRewardDistributor.sol";

interface IDebtTokenStorage is IERC20Upgradeable {
    function bucket() external view returns (IBucketV3);

    function feeDecreaser() external view returns (IFeeExecutor);

    function traderRewardDistributor() external view returns (IActivityRewardDistributor);
}
