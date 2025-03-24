pragma solidity ^0.8.18;

/// Precompiled contract that exist on opBNB chain at 0x420000000000000000000000000000000000000F.
interface IOVM_GasPriceOracle {
    /// @notice returns an upper bound for the L1 fee for a given transaction size.
    /// It is provided for callers who wish to estimate L1 transaction costs in the
    /// write path, and is much more gas efficient than `getL1Fee`.
    /// It assumes the worst case of fastlz upper-bound which covers %99.99 txs.
    /// @param _unsignedTxSize Unsigned fully RLP-encoded transaction size to get the L1 fee for.
    /// @return L1 estimated upper-bound fee that should be paid for the tx
    function getL1FeeUpperBound(uint256 _unsignedTxSize) external view returns (uint256);

    /// @notice Retrieves the current gas price (base fee).
    /// @return Current L2 gas price (base fee).
    function gasPrice() external view returns (uint256);
}
