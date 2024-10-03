// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface IRedeemer {
    event RateChanged(uint256 indexed rate);
    event AdminClaimedEarlyTokens(address indexed token, address indexed to, uint256 indexed amount);
    event AdminClaimedRegularTokens(address indexed token, address indexed to, uint256 indexed amount);

    /**
     * @notice Sets the new exchange rate between ePMX and PMX tokens.
     * Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _rate The new exchange rate in WAD format to be set.
     */
    function changeRate(uint256 _rate) external;

    /**
     * @notice This function allows the sender to redeem a specified amount of tokens.
     * @dev The sender must have a balance of ePMX tokens.
     * The redeemed tokens are transferred to the sender's address.
     */
    function redeem() external;
}
