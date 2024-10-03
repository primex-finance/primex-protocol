// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";

interface IBatchManagerStorage {
    /**
     * @notice Retrieves the address of PositionManager contract.
     */
    function positionManager() external view returns (IPositionManagerV2);

    /**
     * @notice Retrieves the address of PriceOracle contract.
     */
    function priceOracle() external view returns (IPriceOracleV2);

    /**
     * @notice Retrieves the address of WhiteBlackList contract.
     */
    function whiteBlackList() external view returns (IWhiteBlackList);

    /**
     * @notice Retrieves the address of Registry contract.
     */
    function registry() external view returns (address);

    /**
     * @notice Retrieves the gasPerPosition
     */
    function gasPerPosition() external view returns (uint256);

    /**
     * @notice Retrieves the gasPerBatch
     */
    function gasPerBatch() external view returns (uint256);
}
