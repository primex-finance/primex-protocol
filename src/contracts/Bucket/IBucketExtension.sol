// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";

import {IBucketStorageV2} from "./IBucketStorage.sol";
import {IBucketEvents} from "./IBucketEvents.sol";
import {ISwapManager} from "../SwapManager/ISwapManager.sol";

interface IBucketExtension is IBucketStorageV2, IBucketEvents {
    /**
     * @notice Deposits (reinvests) funds from a bucket to another bucket.
     * Used only in the case of failed liquidity mining in the bucket from where the transfer happens.
     * @param _bucketTo The name of the destination bucket.
     * @param _swapManager The address of the swap manager.
     * @param _megaRoutes The array of routes for swapping tokens.
     * @param _amountOutMin The minimum amount of tokens to receive from the swap.
     */
    function depositFromBucket(
        string calldata _bucketTo,
        ISwapManager _swapManager,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin
    ) external;

    /**
     * @notice function to withdraw all liquidity from Aave
     */
    function withdrawBucketLiquidityFromAave() external;
}
