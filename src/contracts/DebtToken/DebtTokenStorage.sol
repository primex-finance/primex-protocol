// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

import "../libraries/Errors.sol";

import {IDebtTokenStorage, IBucketV3, IFeeExecutor, IActivityRewardDistributor} from "./IDebtTokenStorage.sol";

abstract contract DebtTokenStorage is IDebtTokenStorage, ERC20Upgradeable, ERC165Upgradeable {
    IBucketV3 public override bucket;
    IFeeExecutor public override feeDecreaser;
    IActivityRewardDistributor public override traderRewardDistributor;
    address internal bucketsFactory;
    uint8 internal _tokenDecimals;
}
