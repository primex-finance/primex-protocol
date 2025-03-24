// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import {ICurveBaseOracle} from "./ICurveBaseOracle.sol";

interface ICurveVolatileOracle is ICurveBaseOracle {
    /**
     * @notice Fetches the lower bound for the token-to-underlying exchange rate.
     * @dev Used to protect against LP token / share price manipulation.
     */
    function getLowerBound() external view returns (uint256);

    /**
     * @notice Updates the bounds for the exchange rate value
     * @param crvLp The Curve LP token address
     * @param lowerBound The new lower bound (the upper bound is computed dynamically)
     *                   from the lower bound
     */
    function setLimiter(address crvLp, uint256 lowerBound) external;
}
