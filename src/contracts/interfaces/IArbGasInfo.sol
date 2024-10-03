pragma solidity ^0.8.18;

/// Precompiled contract that exists in every Arbitrum Nitro chain at 0x000000000000000000000000000000000000006c.
interface IArbGasInfo {
    // get ArbOS's estimate of the L1 gas price in wei
    function getL1BaseFeeEstimate() external view returns (uint256);

    /// @notice Get gas prices. Uses the caller's preferred aggregator, or the default if the caller doesn't have a preferred one.
    /// @return return gas prices in wei
    ///        (
    ///            per L2 tx,
    ///            per L1 calldata byte
    ///            per storage allocation,
    ///            per ArbGas base,
    ///            per ArbGas congestion,
    ///            per ArbGas total
    ///        )
    function getPricesInWei() external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
}
