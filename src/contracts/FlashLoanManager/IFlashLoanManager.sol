// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPausable} from "../interfaces/IPausable.sol";

interface IFlashLoanManager is IPausable {
    event FlashLoan(
        address indexed target,
        address indexed initiator,
        address indexed asset,
        uint256 amount,
        uint256 flashLoanFee,
        uint256 flashLoanProtocolFee
    );

    event ChangedFlashLoanRates(uint256 flashLoanFeeRate, uint256 flashLoanProtocolRate);

    /**
     * @notice Initializes the contract with the specified parameters.
     * @param _registry The address of the PrimexRegistry contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _whiteBlackList The address of the WhiteBlackList contract.
     * @param _flashLoanFeeRate The percent that is paid by the borrower.
     * @param _flashLoanProtocolRate The percent of the fee paid by the borrower that goes to the Treasury.
     */
    function initialize(
        address _registry,
        address _primexDNS,
        address _whiteBlackList,
        uint256 _flashLoanFeeRate,
        uint256 _flashLoanProtocolRate
    ) external;

    /**
     * @notice Set flashLoanFeeRate and flashLoanProtocolRate.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     */
    function setFlashLoanRates(uint256 _flashLoanFeeRate, uint256 _flashLoanProtocolRate) external;

    /**
     * @notice Borrows without collateral the amounts of tokens from the buckets, transfers them to the receiver.
     * After the call transfers the debts and flashloan fees from the receiver to the buckets and treasury.
     * All of these happens in 1 transaction.
     * @param _receiver The address of the contract that will receive the flash borrowed funds. Must implement the IFlashLoanReceiver interface.
     * @param _buckets The addresses of the buckets from where the assets will be flash borrowed.
     * Buckets should be sorted in ascending order before being passed.
     * @param _amounts The amounts of assets being requested for flash borrow. This needs to contain the same number of entries as assets.
     * @param _params The arbitrary bytes-encoded params that will be passed to executeOperation() method of the receiver contract
     */
    function flashLoan(
        address _receiver,
        address[] calldata _buckets,
        uint256[] calldata _amounts,
        bytes calldata _params
    ) external;
}
