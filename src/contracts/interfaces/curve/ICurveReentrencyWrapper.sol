// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

/**
 * @title ICurveReentrencyWrapper
 * @author BlueberryProtocol
 * @notice This interface serves as a wrapper for Curve LP tokens to prevent reentrancy attacks.
 * @dev Each of these functions should only be used in a reentrancy-protected context.
 *      No sotrage writes will be performed but the goal is to trigger the Curve reentrancy protection
 *      in order to verify that price data is accurate and not being manipulated by a malicious actor.
 */
interface ICurveReentrencyWrapper {
    //  solhint-disable func-name-mixedcase
    function remove_liquidity(uint256 tokenAmount, uint256[] calldata amounts) external view;

    function remove_liquidity(uint256 tokenAmount, uint256[2] calldata amounts) external view;

    function remove_liquidity(uint256 tokenAmount, uint256[3] calldata amounts) external view;

    function remove_liquidity(uint256 tokenAmount, uint256[4] calldata amounts) external view;

    function claim_admin_fees() external view;
}
