// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {ISwapManager} from "../SwapManager/ISwapManager.sol";

interface ILimitOrderManagerStorage {
    function ordersId() external view returns (uint256);

    function orderIndexes(uint256) external view returns (uint256);

    function traderOrderIndexes(uint256) external view returns (uint256);

    function traderOrderIds(address _trader, uint256 _index) external view returns (uint256);

    function bucketOrderIndexes(uint256) external view returns (uint256);

    function bucketOrderIds(address _bucket, uint256 _index) external view returns (uint256);

    function registry() external view returns (IAccessControl);

    function traderBalanceVault() external view returns (ITraderBalanceVault);

    function primexDNS() external view returns (IPrimexDNSV3);

    function pm() external view returns (IPositionManagerV2);

    function swapManager() external view returns (ISwapManager);
}
