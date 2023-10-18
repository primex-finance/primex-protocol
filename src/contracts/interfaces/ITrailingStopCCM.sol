// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface ITrailingStopCCM {
    /**
     * @dev Structure for canBeClosed function of TrailingStop. Params are defined by user at the moment of creation
     * @param activationPrice The price after which trailing stop will be activated
     * @param trailingDelta Percentage of the highest price during the position lifecycle.
     * If price drops below it position should be closed
     */
    struct CanBeClosedParams {
        uint256 activationPrice;
        uint256 trailingDelta;
    }
    /**
     * @dev Structure for canBeClosed function of TrailingStop. Params are defined by keeper at the moment of closing
     * @param highPriceRoundNumber Round numbers of price feeds (baseFeed and quoteFeed) for high price
     * @param lowPriceRoundNumber Round numbers of price feeds (baseFeed and quoteFeed) for low price
     */
    struct AdditionalParams {
        uint80[2] highPriceRoundNumber;
        uint80[2] lowPriceRoundNumber;
    }
}
