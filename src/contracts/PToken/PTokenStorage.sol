// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../libraries/Errors.sol";

import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPTokenStorage, IBucket, IFeeExecutor, IActivityRewardDistributor} from "./IPTokenStorage.sol";

abstract contract PTokenStorage is IPTokenStorage, ERC20Upgradeable, ERC165Upgradeable, ReentrancyGuardUpgradeable {
    IBucket public override bucket;
    IFeeExecutor public override interestIncreaser;
    IActivityRewardDistributor public override lenderRewardDistributor;

    uint256[] internal lockedDepositsIndexes; // index of this array is the depositId, value is the deposit index in user's 'deposits' array
    uint8 internal tokenDecimals;
    mapping(address => LockedBalance) internal lockedBalances;
    address internal bucketsFactory;
}
