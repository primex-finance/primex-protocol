// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

interface IFlashLoanManagerStorage {
    /**
     * @notice Retrieves the instance of PrimexRegistry contract.
     */
    function registry() external view returns (IAccessControl);

    /**
     * @notice Retrieves the instance of PrimexDNS contract.
     */
    function primexDNS() external view returns (IPrimexDNS);

    /**
     * @notice Retrieves the instance of WhiteBlackList contract.
     */
    function whiteBlackList() external view returns (IWhiteBlackList);

    /**
     * @notice Retrieves the percentage of the flash loan size that is paid by the borrower.
     * Expressed in the WAD format: 1e17 = 10%, 1e18 = 100%, and so forth.
     */
    function flashLoanFeeRate() external view returns (uint256);

    /**
     * @notice Retrieves the percentage of the flash loan fee paid by the borrower that goes to the Treasury.
     * Expressed in the WAD format: 1e17 = 10%, 1e18 = 100%, and so forth.
     */
    function flashLoanProtocolRate() external view returns (uint256);
}
