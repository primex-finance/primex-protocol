pragma solidity ^0.8.18;

/// Precompiled contract that exist on opBNB chain at 0x420000000000000000000000000000000000000F.
interface IOVM_GasPriceOracle {
    /// @notice Retrieves the latest known L1 base fee.
    /// @return Latest known L1 base fee.
    function l1BaseFee() external view returns (uint256);

    /// @notice Retrieves the current fee overhead.
    /// @return Current fee overhead.
    function overhead() external view returns (uint256);

    /// @notice Retrieves the current fee scalar.
    /// @return Current fee scalar.
    function scalar() external view returns (uint256);
}
