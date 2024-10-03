// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IQuoter} from "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {ICurveCalc} from "./routers/ICurveCalc.sol";
import {ICurveRegistry} from "./routers/ICurveRegistry.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";

interface IDexAdapter {
    /**
     * @notice Possible dex types
     */
    enum DexType {
        none, // 0
        UniswapV2, // 1  "uniswap", "sushiswap", "quickswap" (v2)
        UniswapV3, // 2
        Curve, // 3
        Balancer, // 4
        AlgebraV3, // 5
        Meshswap, // 6
        Paraswap //7
    }

    /*
     * @param encodedPath Swap path encoded in bytes
     * Encoded differently for different dexes:
     * Uniswap v2 - just encoded array of asset addresses
     * Uniswap v3 - swap path is a sequence of bytes. In Solidity, a path can be built like that:
     *      bytes.concat(bytes20(address(weth)), bytes3(uint24(pool1Fee)), bytes20(address(usdc)), bytes3(uint24(pool2Fee)) ...)
     * Quickswap - swap path is a sequence of bytes. In Solidity, a path can be built like that:
     *      bytes.concat(bytes20(address(weth)), bytes20(address(usdc)), bytes20(address(usdt) ...)
     * Curve - encoded array of asset addresses and pool addresses
     * Balancer - encoded array of asset addresses, pool ids and asset limits
     * @param _amountIn TokenA amount in
     * @param _amountOutMin Min tokenB amount out
     * @param _to Destination address for swap
     * @param _deadline Timestamp deadline for swap
     * @param _dexRouter Dex router address
     */
    struct SwapParams {
        bytes encodedPath;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        address to;
        uint256 deadline;
        address dexRouter;
    }

    /*
     * @param encodedPath Swap path encoded in bytes
     * @param _amountIn TokenA amount in
     * @param _dexRouter Dex router address
     */
    struct GetAmountsParams {
        bytes encodedPath;
        uint256 amount; // amountIn or amountOut
        address dexRouter;
    }

    struct AmountParams {
        address tokenA;
        address tokenB;
        uint256 amount;
        PrimexPricingLibrary.MegaRoute[] megaRoutes;
    }

    struct MegaSwapVars {
        uint256 sumOfShares;
        uint256 amountOnMegaRoute;
        uint256 totalAmount;
        uint256 remainder;
    }

    event QuoterChanged(address indexed dexRouter, address indexed quoter);
    event DexTypeChanged(address indexed dexRouter, uint256 indexed dexType);

    /**
     * @param _dexRouter The router address for which the quoter is set
     * @param _quoter The quoter address to set
     */
    function setQuoter(address _dexRouter, address _quoter) external;

    /**
     * @notice Set a dex type for a dex router
     * @param _dexRouter The dex router address
     * @param _dexType The dex type from enum DexType
     */
    function setDexType(address _dexRouter, uint256 _dexType) external;

    /**
     * @notice Swap ERC20 tokens
     * @param _params SwapParams struct
     */
    function swapExactTokensForTokens(SwapParams memory _params) external payable returns (uint256[3] memory);

    /**
     * @notice Performs chained getAmountOut calculations
     * @notice given an input amount of an asset, returns the maximum output amount of the other asset
     * @param _params GetAmountsParams struct
     */
    function getAmountsOut(GetAmountsParams memory _params) external returns (uint256[3] memory);

    /**
     * @notice Performs chained getAmountIn calculations
     * @notice given an output amount of an asset, returns the maximum input amount of the other asset
     * @param _params GetAmountsParams struct
     */
    function getAmountsIn(GetAmountsParams memory _params) external returns (uint256[3] memory);

    /**
     * @notice Dex type mapping dexRouter => dex type
     */
    function dexType(address) external view returns (DexType);

    /**
     * @notice Mapping from the dexRouter to its quoter
     */
    function quoters(address) external view returns (address);

    /**
     * @return The address of the Registry contract
     */
    function registry() external view returns (address);

    /**
     * @notice Gets the average amount of gas that is required for the swap on some dex
     * @param dexRouter The address of a router
     */
    function getGas(address dexRouter) external view returns (uint256);

    /**
     * @notice perform swap of ERC20 tokens by Path structs
     * @param tokenIn source token
     * @param tokenOut destination token
     * @param amountIn amount in the source token
     * @param receiver destination address for swap
     * @param paths Array of Path structs
     */
    function performPathsSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address receiver,
        PrimexPricingLibrary.Path[] calldata paths
    ) external payable returns (uint256);

    /**
      @notice Performs chained getAmountOut calculations by Path structs
      @dev The function may not support some types of dex, e.g. the Paraswap
     * @param amountIn amount in the source token
     * @param paths Array of Path structs
     */

    function getAmountsOutByPaths(
        uint256 amountIn,
        PrimexPricingLibrary.Path[] calldata paths
    ) external returns (uint256);

    /**
      @notice Performs chained getAmountsIn calculations by Path structs
      @dev The function may not support some types of dex, e.g. the Paraswap
     * @param amountOut amount in the destination token
     * @param paths Array of Path structs
     */

    function getAmountsInByPaths(
        uint256 amountOut,
        PrimexPricingLibrary.Path[] calldata paths
    ) external returns (uint256);

    /**
       @notice perform swap of ERC20 tokens by MegaRoute structs
     * @param _params MegaSwapParams struct
     */
    function performMegaRoutesSwap(
        PrimexPricingLibrary.MegaSwapParams calldata _params
    ) external payable returns (uint256);

    /**
     * @notice perform swap of ERC20 tokens by Route structs
     * @param tokenIn source token
     * @param amountIn amount in the source token
     * @param receiver destination address for swap
     * @param routes Array of Route structs
     */
    function performRoutesSwap(
        address tokenIn,
        uint256 amountIn,
        address receiver,
        PrimexPricingLibrary.Route[] calldata routes
    ) external payable returns (uint256);

    /**
    @notice Performs chained getAmountsOut calculations by Route structs
      @dev The function may not support some types of dex, e.g. the Paraswap
     * @param amountIn amount in the source token
     * @param routes Array of Route structs
     */

    function getAmountsOutByRoutes(
        uint256 amountIn,
        PrimexPricingLibrary.Route[] calldata routes
    ) external returns (uint256);

    /**
       @notice Performs chained getAmountsOut calculations by MegaRoute structs
       @dev The function may not support some types of dex, e.g. the Paraswap
     * @param _params AmountParams struct
     */
    function getAmountOutByMegaRoutes(AmountParams calldata _params) external returns (uint256);

    /**
      @notice Performs chained  getAmountsIn calculations by Route structs
      @dev The function may not support some types of dex, e.g. the Paraswap
     * @param amountOut amountin the destination token
     * @param routes Array of Route structs
     */

    function getAmountsInByRoutes(
        uint256 amountOut,
        PrimexPricingLibrary.Route[] calldata routes
    ) external returns (uint256);

    /**
       @notice Performs chained getAmountsIn calculations by MegaRoute structs
       @dev The function may not support some types of dex, e.g. the Paraswap
     * @param _params AmountParams struct
     */
    function getAmountInByMegaRoutes(AmountParams calldata _params) external returns (uint256);

    receive() external payable;

    /**
     * @notice  Initializes the DexAdapter contract.
     * @dev This function should only be called once during the initial setup of the contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     */
    function initialize(address _primexDNS) external;
}
