// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";

import {IPrimexDNSV3, IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPausable} from "../interfaces/IPausable.sol";

interface ISwapManager is IPausable {
    event SpotSwap(
        address indexed trader,
        address indexed receiver,
        address tokenA,
        address tokenB,
        uint256 amountSold,
        uint256 amountBought
    );
    event PaidProtocolFee(
        address indexed trader,
        address indexed boughtAsset,
        IPrimexDNSStorageV3.FeeRateType indexed feeRateType,
        uint256 feeInPositionAsset,
        uint256 feeInPmx
    );

    /**
     * @param tokenA The address of the asset to be swapped from.
     * @param tokenB The address of the asset to be received in the swap.
     * @param amountTokenA The amount of tokenA to be swapped.
     * @param amountOutMin The minimum amount of tokenB expected to receive.
     * @param routes An array of PrimexPricingLibrary.Route structs representing the routes for the swap.
     * @param receiver The address where the swapped tokens will be received.
     * @param deadline The deadline for the swap transaction.
     * @param isSwapFromWallet A flag indicating whether the swap is perfomed from a wallet or a protocol balance.
     * @param isSwapToWallet A flag indicating whether the swapped tokens will be sent to a wallet or a protocol balance.
     * @param isSwapFeeInPmx A flag indicating whether the swap fee is paid in PMX or in native token.
     */
    struct SwapParams {
        address tokenA;
        address tokenB;
        uint256 amountTokenA;
        uint256 amountOutMin;
        PrimexPricingLibrary.MegaRoute[] megaRoutes;
        address receiver;
        uint256 deadline;
        bool isSwapFromWallet;
        bool isSwapToWallet;
        bool isSwapFeeInPmx;
        bytes tokenAtokenBOracleData;
        bytes pmxPositionAssetOracleData;
        bytes nativePositionAssetOracleData;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
    }

    /**
     * @param depositAsset The address of the deposited asset.
     * @param positionAsset The address of the position asset.
     * @param depositAmount Amount of tokens in a deposit asset.
     * @param megaRoutes An array of PrimexPricingLibrary.Route structs representing the routes for the swap.
     * @param trader The trader address, who has created the order.
     * @param deadline The deadline for the swap transaction.
     * @param feeToken An asset in which the fee will be paid. At this point it could be the pmx, the epmx or a positionAsset
     * @param keeperRewardDistributor The address of KeeperRewardDistributor contract.
     * @param gasSpent Gas spent on executing transaction.
     */
    struct SwapInLimitOrderParams {
        address depositAsset;
        address positionAsset;
        uint256 depositAmount;
        PrimexPricingLibrary.MegaRoute[] megaRoutes;
        address trader;
        uint256 deadline;
        address feeToken;
        address keeperRewardDistributor;
        uint256 gasSpent;
        bytes depositPositionAssetOracleData;
        bytes pmxPositionAssetOracleData;
        bytes nativePositionAssetOracleData;
    }

    /**
     * @notice Initializes the contract with the specified parameters.
     * @param _registry The address of the PrimexRegistry contract.
     */
    function initialize(address _registry) external;

    /**
     * @notice Re-initializes the contract with the specified parameters.
     * @dev Only BIG_TIMELOCK_ADMIN can call it.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _traderBalanceVault The address of the TraderBalanceVault contract.
     * @param _priceOracle The address of the PriceOracle contract.
     * @param _whiteBlackList The address of the WhiteBlackList contract.
     */
    function initializeAfterUpgrade(
        address _primexDNS,
        address payable _traderBalanceVault,
        address _priceOracle,
        address _whiteBlackList
    ) external;

    /**
     * @notice Executes a swap on dexes defined in routes
     * @param params The SwapParams struct containing the details of the swap transaction.
     * @param maximumOracleTolerableLimit The maximum tolerable limit in WAD format (1 WAD = 100%)
     * @param needOracleTolerableLimitCheck Flag indicating whether to perform an oracle tolerable limit check.
     * @return The resulting amount after the swap.
     */
    function swap(
        SwapParams calldata params,
        uint256 maximumOracleTolerableLimit,
        bool needOracleTolerableLimitCheck
    ) external payable returns (uint256);

    /**
     * @notice Executes a swap on dexes defined in routes
     * @dev Only callable by the LOM_ROLE role.
     * @param params The SwapInLimitOrderParams struct containing the details of the swap transaction.
     * @param maximumOracleTolerableLimit The maximum tolerable limit in WAD format (1 WAD = 100%)
     * @return The resulting amount after the swap and feeInPositionAsset.
     */
    function swapInLimitOrder(
        SwapInLimitOrderParams calldata params,
        uint256 maximumOracleTolerableLimit
    ) external returns (uint256, uint256);
}
