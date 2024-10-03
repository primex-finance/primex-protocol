// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IAToken} from "@aave/core-v3/contracts/interfaces/IAToken.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import "../libraries/Errors.sol";

import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IBucketStorage, IBucketStorageV2} from "./IBucketStorage.sol";
import {IPToken} from "../PToken/IPToken.sol";
import {IDebtToken} from "../DebtToken/IDebtToken.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IPrimexDNSStorage} from "../PrimexDNS/IPrimexDNSStorage.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IReserve} from "../Reserve/IReserve.sol";
import {IInterestRateStrategy} from "../interfaces/IInterestRateStrategy.sol";
import {ILiquidityMiningRewardDistributor} from "../LiquidityMiningRewardDistributor/ILiquidityMiningRewardDistributor.sol";

abstract contract BucketStorage is IBucketStorage, ReentrancyGuardUpgradeable, ERC165Upgradeable {
    string public override name;
    address public override registry;
    IPositionManagerV2 public override positionManager;
    IReserve public override reserve;
    IPToken public override pToken;
    IDebtToken public override debtToken;
    IERC20Metadata public override borrowedAsset;
    uint256 public override feeBuffer;
    // The current borrow rate, expressed in ray. bar = borrowing annual rate (originally APR)
    uint128 public override bar;
    // The current interest rate, expressed in ray. lar = lending annual rate (originally APY)
    uint128 public override lar;
    // The estimated borrowing annual rate, expressed in ray
    uint128 public override estimatedBar;
    // The estimated lending annual rate, expressed in ray
    uint128 public override estimatedLar;
    uint128 public override liquidityIndex;
    uint128 public override variableBorrowIndex;
    // block where indexes were updated
    uint256 public lastUpdatedBlockTimestamp;
    uint256 public override permanentLossScaled;
    uint256 public reserveRate;
    uint256 public override withdrawalFeeRate;
    IWhiteBlackList public override whiteBlackList;
    mapping(address => Asset) public override allowedAssets;
    IInterestRateStrategy public interestRateStrategy;
    uint256 public aaveDeposit;
    bool public isReinvestToAaveEnabled;
    uint256 public override maxTotalDeposit;
    address[] internal assets;
    // solhint-disable-next-line var-name-mixedcase
    LiquidityMiningParams internal LMparams;
    IPrimexDNSV3 internal dns;
    IPriceOracleV2 internal priceOracle;
}

abstract contract BucketStorageV2 is IBucketStorageV2, BucketStorage {
    address public override bucketExtension;
}
