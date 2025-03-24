// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ITraderBalanceVaultV2} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPrimexNFT} from "../PrimexNFT/IPrimexNFT.sol";

interface ITiersManagerStorage {
    /**
     * @notice Retrieves the instance of PrimexRegistry contract.
     */
    function registry() external view returns (IAccessControl);

    /**
     * @notice Retrieves the EPMX address
     */
    function pmx() external view returns (address);

    /**
     * @notice Retrieves the instance of TraderBalanceVault contract.
     */
    function traderBalanceVault() external view returns (ITraderBalanceVaultV2);

    function lendingNFT() external view returns (IPrimexNFT);

    function tradingNFT() external view returns (IPrimexNFT);

    function farmingNFT() external view returns (IPrimexNFT);

    function tiersThresholds(uint256 tier) external view returns (uint256);
}
