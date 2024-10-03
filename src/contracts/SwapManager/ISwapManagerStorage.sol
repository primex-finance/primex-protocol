// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

interface ISwapManagerStorage {
    /**
     * @notice Retrieves the instance of PrimexRegistry contract.
     */
    function registry() external view returns (IAccessControl);

    /**
     * @notice Retrieves the instance of TraderBalanceVault contract.
     */
    function traderBalanceVault() external view returns (ITraderBalanceVault);

    /**
     * @notice Retrieves the instance of PrimexDNS contract.
     */
    function primexDNS() external view returns (IPrimexDNSV3);

    /**
     * @notice Retrieves the instance of PriceOracle contract.
     */
    function priceOracle() external view returns (IPriceOracleV2);

    /**
     * @notice Retrieves the instance of WhiteBlackList contract.
     */
    function whiteBlackList() external view returns (IWhiteBlackList);
}
