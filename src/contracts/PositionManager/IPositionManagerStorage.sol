// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {ISpotTradingRewardDistributorV2} from "../SpotTradingRewardDistributor/ISpotTradingRewardDistributor.sol";

interface IPositionManagerStorage {
    function maxPositionSize(address, address) external returns (uint256);

    function defaultOracleTolerableLimit() external returns (uint256);

    function securityBuffer() external view returns (uint256);

    function maintenanceBuffer() external view returns (uint256);

    function positionsId() external view returns (uint256);

    function traderPositionIds(address _trader, uint256 _index) external view returns (uint256);

    function bucketPositionIds(address _bucket, uint256 _index) external view returns (uint256);

    function registry() external view returns (IAccessControl);

    function traderBalanceVault() external view returns (ITraderBalanceVault);

    function primexDNS() external view returns (IPrimexDNSV3);

    function priceOracle() external view returns (IPriceOracleV2);

    function keeperRewardDistributor() external view returns (IKeeperRewardDistributorV3);

    function spotTradingRewardDistributor() external view returns (ISpotTradingRewardDistributorV2);

    function minPositionSize() external view returns (uint256);

    function minPositionAsset() external view returns (address);
}

interface IPositionManagerStorageV2 {
    function positionManagerExtension() external view returns (address);
}
