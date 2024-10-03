// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

import {IPrimexDNSStorage, IPrimexDNSStorageV2, IPrimexDNSStorageV3} from "./IPrimexDNSStorage.sol";

abstract contract PrimexDNSStorage is IPrimexDNSStorage, ERC165Upgradeable {
    address public override registry;

    /**
     * @notice check the scheme below for additional info
     */
    uint256 public override delistingDelay;
    uint256 public override adminWithdrawalDelay;

    /* solhint-disable max-line-length */
    //                                          =========================================================
    //                                            "delistingDelay" and "adminWithdrawalDelay" explained
    //                                          =========================================================

    //                  * Lenders can’t add liquidity to Bucket.         * Keepers can close all positions opened                * Admin can withdraw all funds from the bucket to Treasury.
    //                  * New positions or orders can’t be opened          through this Bucket.                                  * Admin can withdraw to Treasury all PMX rewards granted to
    //                    in this Bucket.                                * Lenders can withdraw their funds, which became          this bucket for liquidity mining (except already withdrawn amount).
    //                  * Lenders can withdraw existing deposits,          available after all positions were closed by
    //                    traders can close existing positions.            keepers.
    //
    //                |----------------delistingDelay------------------|---------------adminWithdrawalDelay------------------|---------------------------------------------------------------
    //                |                                                |                                                     |
    //      ----------|------------------------------------------------|-----------------------------------------------------|---------------------------------------------------------------
    //                |                                        delistingDeadline                                        adminDeadline
    //      -= bucket is DEPRECATED =-                      -= bucket is DELISTED =-
    //
    //
    /* solhint-enable max-line-length */

    address public override pmx;
    address public override treasury;
    mapping(string => BucketData) public override buckets;
    mapping(string => DexData) public override dexes;
    mapping(uint256 => address) public override cmTypeToAddress;
    address public override dexAdapter;
    address public override aavePool;

    // action to token to fee amount
    mapping(OrderType => mapping(address => uint256)) public override feeRates;

    string[] internal dexesNames;
}

abstract contract PrimexDNSStorageV2 is IPrimexDNSStorageV2, PrimexDNSStorage {
    mapping(OrderType => FeeRestrictions) public override feeRestrictions;
}

abstract contract PrimexDNSStorageV3 is IPrimexDNSStorageV3, PrimexDNSStorageV2 {
    mapping(FeeRateType => uint256) public override protocolFeeRates;
    // Mapping to store average gas per action for different trading order types
    mapping(TradingOrderType => uint256) public override averageGasPerAction;
    // Mapping to store min protocol fee restrictions for different calling method
    mapping(CallingMethod => MinFeeRestrictions) public override minFeeRestrictions;
    // measured in NATIVE_CURRENCY
    uint256 public override maxProtocolFee;
    // additional coefficient to calculate minProtocolFee, measured in wei
    uint256 public override protocolFeeCoefficient;
    // average gas amount spent for a single liquidation, measured in wei
    uint256 public override liquidationGasAmount;
    // gas that will be additionally spend after gasSpent calculation
    uint256 public override additionalGasSpent;
    uint256 public override pmxDiscountMultiplier;
    // protects position from immediate liquidation after gas price changed
    uint256 public override gasPriceBuffer;
}
