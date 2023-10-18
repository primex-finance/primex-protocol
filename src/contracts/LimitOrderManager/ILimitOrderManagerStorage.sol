// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPositionManager} from "../PositionManager/IPositionManager.sol";
import {ISwapManager} from "../interfaces/ISwapManager.sol";

interface ILimitOrderManagerStorage {
    function ordersId() external view returns (uint256);

    function orderIndexes(uint256) external view returns (uint256);

    function traderOrderIndexes(uint256) external view returns (uint256);

    function traderOrderIds(address _trader, uint256 _index) external view returns (uint256);

    function bucketOrderIndexes(uint256) external view returns (uint256);

    function bucketOrderIds(address _bucket, uint256 _index) external view returns (uint256);

    function registry() external view returns (IAccessControl);

    function traderBalanceVault() external view returns (ITraderBalanceVault);

    function primexDNS() external view returns (IPrimexDNS);

    function pm() external view returns (IPositionManager);

    function swapManager() external view returns (ISwapManager);
}
