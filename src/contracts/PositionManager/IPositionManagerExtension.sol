// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";

import {IPositionManagerStorageV2} from "../PositionManager/IPositionManagerStorage.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {IPositionManagerEvents} from "./IPositionManagerEvents.sol";

interface IPositionManagerExtension is IPositionManagerStorageV2, IPositionManagerEvents {
    /**
     * @param token0 The address of the first token in the pair.
     * @param token1 The address of the second token in the pair.
     * @param amountInToken0 The maximum amount of token0 allowed in the position.
     * @param amountInToken1 The maximum amount of token1 allowed in the position.
     */
    struct MaxPositionSizeParams {
        address token0;
        address token1;
        uint256 amountInToken0;
        uint256 amountInToken1;
    }

    /**
     * @param assetA The address of the first asset.
     * @param assetB The address of the second asset.
     * @param percent The new value for the oracle tolerable limit between two assets. Measured in WAD (1 WAD = 100%).
     */
    struct OracleTolerableLimitsParams {
        address assetA;
        address assetB;
        uint256 percent;
    }

    /**
     * @notice Sets the maximum position size for a pair of tokens.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _token0 The address of the first token in the pair.
     * @param _token1 The address of the second token in the pair.
     * @param _amountInToken0 The maximum amount of token0 allowed in the position.
     * @param _amountInToken1 The maximum amount of token1 allowed in the position.
     */
    function setMaxPositionSize(
        address _token0,
        address _token1,
        uint256 _amountInToken0,
        uint256 _amountInToken1
    ) external;

    /**
     * @notice Same as the setMaxPositionSize but for a batch of sizes
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _params The array of MaxPositionSizeParams structs
     */
    function setMaxPositionSizes(MaxPositionSizeParams[] calldata _params) external;

    /**
     * @notice Sets the default oracle tolerable limit for the protocol.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _percent The new value for the default oracle tolerable limit. Measured in WAD (1 WAD = 100%).
     */
    function setDefaultOracleTolerableLimit(uint256 _percent) external;

    /**
     * @notice Sets the oracle tolerable limit between two assets.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _assetA The address of the first asset.
     * @param _assetB The address of the second asset.
     * @param _percent The new value for the oracle tolerable limit between two assets. Measured in WAD (1 WAD = 100%).
     */
    function setOracleTolerableLimit(address _assetA, address _assetB, uint256 _percent) external;

    /**
     * @notice Same as the setOracleTolerableLimit but for a batch of limits
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _limitParams The array of the OracleTolerableLimitsParams sctructs
     */

    function setOracleTolerableLimits(OracleTolerableLimitsParams[] calldata _limitParams) external;

    /**
     * @notice Function to set oracleTolerableLimitMultiplier.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param newMultiplier New multiplier in WAD format.
     */
    function setOracleTolerableLimitMultiplier(uint256 newMultiplier) external;

    /**
     * @notice Sets the security buffer value.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * 0 <= newSecurityBuffer < 1.
     * Buffer security parameter is used in calculating the liquidation conditions
     * https://docs.google.com/document/d/1kR8eaqV4289MAbLKgIfKsZ2NgjFpeC0vpVL7jVUTvho/edit#bookmark=id.i9v508hvrv42
     * @param newSecurityBuffer The new value of the security buffer in WAD format.
     */
    function setSecurityBuffer(uint256 newSecurityBuffer) external;

    /**
     * @notice Sets the maintenance buffer value.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * The new maintenance buffer value should be greater than zero and less than one.
     * Maintenance buffer is used in calculating the maximum leverage
     * https://docs.google.com/document/d/1kR8eaqV4289MAbLKgIfKsZ2NgjFpeC0vpVL7jVUTvho/edit#bookmark=id.87oc1j1s9z21
     * @param newMaintenanceBuffer The new value of the maintenance buffer in WAD format.
     */
    function setMaintenanceBuffer(uint256 newMaintenanceBuffer) external;

    /**
     * @notice Sets the address of the SpotTradingRewardDistributor contract.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _spotTradingRewardDistributor The address of the SpotTradingRewardDistributor contract.
     */
    function setSpotTradingRewardDistributor(address _spotTradingRewardDistributor) external;

    /**
     * @notice Sets the KeeperRewardDistributor contract.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _keeperRewardDistributor The instance of the KeeperRewardDistributor contract.
     */
    function setKeeperRewardDistributor(IKeeperRewardDistributorV3 _keeperRewardDistributor) external;

    /**
     * @notice Allows the trader to partially close a position.
     * @param _positionId The ID of the position to be partially closed.
     * @param _amount The amount of the position asset to be closed from the position.
     * @param _depositReceiver The address where the remaining deposit will be sent.
     * @param _megaRoutes The routing information for swapping assets.
     * @param _amountOutMin The minimum amount to be received after swapping, measured in the same decimal format as the position's asset.
     */
    function partiallyClosePosition(
        uint256 _positionId,
        uint256 _amount,
        address _depositReceiver,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin,
        bytes calldata _positionSoldAssetOracleData,
        bytes calldata _nativePositionAssetOracleData,
        bytes calldata _pmxPositionAssetOracleData,
        bytes[] calldata _pullOracleData
    ) external payable;

    /**
     * @notice Opens a position based on the provided order parameters.
     * @dev Only callable by the LOM_ROLE role.
     * @param _params The parameters for opening a position.
     * @return The total borrowed amount, position amount, position ID, and entry price of the new position.
     */
    function openPositionByOrder(
        LimitOrderLibrary.OpenPositionByOrderParams calldata _params
    ) external returns (uint256, uint256, uint256, uint256, uint256);

    /**
     * @notice Opens margin position.
     * @dev Locks trader's collateral in TraderBalanceVault. Takes loan from bucket for deal.
     * Makes swap bucket borrowedAsset amount on '_dex'. Updates rates and indexes in the '_bucket'.
     * Mints debtToken for trader (msg.sender)
     * @param _params The parameters required to open a position.
     */
    function openPosition(PositionLibrary.OpenPositionParams calldata _params) external payable;

    /**
     * @notice Decreases the deposit amount for a given position.
     * @param _positionId The ID of the position.
     * @param _amount The amount to decrease the deposit by.
     */
    function decreaseDeposit(
        uint256 _positionId,
        uint256 _amount,
        bytes memory _positionSoldAssetOracleData,
        bytes[] calldata _pullOracleData
    ) external payable;

    /**
     * @notice Updates the position with the given position ID by setting new close conditions.
     * @param _positionId The ID of the position to update.
     * @param _closeConditions An array of close conditions for the position.
     * @dev The caller of this function must be the trader who owns the position.
     * @dev Emits an `UpdatePositionConditions` event upon successful update.
     */
    function updatePositionConditions(
        uint256 _positionId,
        LimitOrderLibrary.Condition[] calldata _closeConditions
    ) external;

    /**
     * @notice Returns the oracle tolerable limit for the given asset pair.
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @return The oracle tolerable limit in WAD format (1 WAD = 100%) for the asset pair.
     */
    function getOracleTolerableLimit(address assetA, address assetB) external view returns (uint256);
}
