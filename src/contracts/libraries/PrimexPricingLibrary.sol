// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BytesLib} from "./utils/BytesLib.sol";
import {WadRayMath} from "./utils/WadRayMath.sol";

import {NATIVE_CURRENCY, USD, USD_MULTIPLIER, ARB_NITRO_ORACLE, OVM_GASPRICEORACLE, GAS_FOR_BYTE, TRANSACTION_METADATA_BYTES} from "../Constants.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";
import {IPriceOracle} from "../PriceOracle/IPriceOracle.sol";
import {IKeeperRewardDistributorStorage, IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {IPrimexDNSV3, IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {TokenTransfersLibrary} from "./TokenTransfersLibrary.sol";
import {IPriceOracleStorageV2} from "../PriceOracle/IPriceOracleStorage.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import "./Errors.sol";

library PrimexPricingLibrary {
    using WadRayMath for uint256;
    using BytesLib for bytes;

    /**
     * @param dexName The name of the DEX.
     * @param shares the share that will be allocated from the total amount for the route
     * @param payload payload data encoded in bytes
     */

    struct Path {
        string dexName;
        uint256 shares;
        bytes payload;
    }

    /**
     * @param to the destination token of the route
     * @param paths path array through which the swap will be made up to the destination token this the route
     */

    struct Route {
        address to;
        Path[] paths;
    }

    /**
     * @param shares the share that will be allocated from the total amount for this MegaRoute
     * @param routes array of routes through which the swap will be made up to TokenB
     */
    struct MegaRoute {
        uint256 shares;
        Route[] routes;
    }

    struct MegaSwapParams {
        address tokenA;
        address tokenB;
        uint256 amountTokenA;
        MegaRoute[] megaRoutes;
        address receiver;
        uint256 deadline;
    }

    struct AmountParams {
        address tokenA;
        address tokenB;
        uint256 amount;
        MegaRoute[] megaRoutes;
        address dexAdapter;
        address primexDNS;
    }

    struct DepositData {
        address depositAsset;
        uint256 depositAmount;
        uint256 leverage;
    }

    /**
     * @param feeToken An asset in which the fee will be paid.
     * @param trader The trader address
     * @param priceOracle PriceOracle contract address
     * @param orderType Type of possible order in Primex protocol
     * @param traderBalanceVault TraderBalanceVault contract address
     * @param primexDNS PrimexDNS contract address
     */
    struct ProtocolFeeParams {
        address feeToken;
        address trader;
        address priceOracle;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        ITraderBalanceVault traderBalanceVault;
        address swapManager;
        address keeperRewardDistributor;
        IPrimexDNSV3 primexDNS;
        address paymentAsset;
        uint256 paymentAmount;
        uint256 gasSpent;
        bool isFeeProhibitedInPmx;
        bytes pmxPaymentAssetOracleData;
        bytes nativePaymentAssetOracleData;
    }

    struct ProtocolFeeParamsBatchClose {
        uint256 numberOfPositions;
        address[] feeTokens;
        address[] traders;
        uint256[] paymentAmounts;
        address paymentAsset;
        address priceOracle;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        ITraderBalanceVault traderBalanceVault;
        address keeperRewardDistributor;
        IPrimexDNSV3 primexDNS;
        uint256 estimatedGasAmount;
        bool isFeeProhibitedInPmx;
        uint256 estimatedBaseLength;
        bytes nativePaymentAssetOracleData;
        bytes pmxPaymentAssetOracleData;
    }

    struct CalculateFeeInPaymentAssetParams {
        IPrimexDNSV3 primexDNS;
        address priceOracle;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        address paymentAsset;
        uint256 paymentAmount;
        address keeperRewardDistributor;
        uint256 gasSpent;
        bool isFeeProhibitedInPmx;
        bytes nativePaymentAssetOracleData;
    }

    struct MinProtocolFeeParams {
        uint256 restrictedGasSpent;
        address paymentAsset;
        address priceOracle;
        IKeeperRewardDistributorV3 keeperRewardDistributor;
        IPrimexDNSV3 primexDNS;
        bool isFeeProhibitedInPmx;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        bytes nativePaymentAssetOracleData;
    }

    /**
     * The struct for payProtocolFee function
     */
    struct ProtocolFeeVars {
        address pmx;
        address treasury;
        uint256 feeInPaymentAssetWithDiscount;
        uint256 pmxTraderBalance;
        uint256 pmxTraderBalanceInPaymentAsset;
        uint256 pmxDiscountMultiplier;
    }

    /**
     * The struct for calculateFeeInPaymentAssetVars function
     */
    struct FeeInPaymentAssetVars {
        uint256 protocolFeeRate;
        uint256 maxProtocolFee;
        uint256 feeInPaymentAsset;
        uint256 maxProtocolFeeInPaymentAsset;
        uint256 minProtocolFeeInPaymentAsset;
    }

    /**
     * The struct for minProtocolFee function
     */
    struct MinProtocolFeeVars {
        uint256 maxGasAmount;
        uint256 restrictedGasPrice;
        uint256 l1CostWei;
        uint256 liquidationGasAmount;
        uint256 protocolFeeCoefficient;
        uint256 additionalGasSpent;
        uint256 minProtocolFeeInNativeAsset;
        uint256 totalGasSpent;
        uint256 baseLength;
        uint256 optimisticGasCoefficient;
        IPrimexDNSStorageV3.CallingMethod callingMethod;
        IKeeperRewardDistributorStorage.PaymentModel paymentModel;
    }

    /**
     * The struct for calculateFeeInPaymentAssetBatchClose function
     */
    struct CalculateFeeInPaymentAssetBatchCloseVars {
        uint256[] feeInPaymentAsset;
        uint256 protocolFeeRate;
        uint256 maxProtocolFee;
        uint256 maxProtocolFeeInPaymentAsset;
        uint256 minProtocolFeeInPaymentAsset;
    }

    /**
     * The struct for calculateRestrictedGasPrice function
     */
    struct RestrictedGasPriceVars {
        int256 oracleGasPrice;
        uint256 maxGasPrice;
        uint256 defaultMaxGasPrice;
        uint256 oracleGasPriceTolerance;
    }

    /**
     * The struct for getLiquidationPrice and getLiquidationPriceByOrder functions
     */
    struct LiquidationPriceData {
        IBucketV3 bucket;
        IPositionManagerV2 positionManager;
        IPriceOracleV2 priceOracle;
        IERC20Metadata borrowedAsset;
    }

    event Withdraw(
        address indexed withdrawer,
        address borrowAssetReceiver,
        address borrowedAsset,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @notice Encodes the given parameters into a bytes array based on the specified DEX type.
     * @param path The token path for the swap.
     * @param dexRouter The address of the DEX router.
     * @param ancillaryData Additional data required for certain DEX types.
     * @param dexAdapter The address of the DEX adapter.
     * @param isAmountToBuy A flag indicating whether it is the path for the swap with fixed amountIn or amountOut.
     * Swap with fixed amountIn, if true.
     * @return The encoded bytes array.
     */
    function encodePath(
        address[] memory path,
        address dexRouter,
        bytes32 ancillaryData,
        address payable dexAdapter,
        bool isAmountToBuy
    ) external view returns (bytes memory) {
        IDexAdapter.DexType type_ = IDexAdapter(dexAdapter).dexType(dexRouter);

        if (type_ == IDexAdapter.DexType.UniswapV2 || type_ == IDexAdapter.DexType.Meshswap) {
            return abi.encode(path);
        }
        if (type_ == IDexAdapter.DexType.UniswapV3) {
            if (isAmountToBuy)
                return bytes.concat(bytes20(path[1]), bytes3(uint24(uint256(ancillaryData))), bytes20(path[0]));
            return bytes.concat(bytes20(path[0]), bytes3(uint24(uint256(ancillaryData))), bytes20(path[1]));
        }
        if (type_ == IDexAdapter.DexType.AlgebraV3) {
            if (isAmountToBuy) return bytes.concat(bytes20(path[1]), bytes20(path[0]));
            return bytes.concat(bytes20(path[0]), bytes20(path[1]));
        }
        if (type_ == IDexAdapter.DexType.Curve) {
            address[] memory pools = new address[](1);
            pools[0] = address(uint160(uint256(ancillaryData)));
            return abi.encode(path, pools);
        }
        if (type_ == IDexAdapter.DexType.Balancer) {
            int256[] memory limits = new int256[](2);
            limits[0] = type(int256).max;
            bytes32[] memory pools = new bytes32[](1);
            pools[0] = ancillaryData;
            return abi.encode(path, pools, limits);
        }
        _revert(Errors.UNKNOWN_DEX_TYPE.selector);
    }

    /**
     * @notice Calculates the amount of deposit assets in borrowed assets.
     * @param _params The parameters for the calculation.
     * @param _isThirdAsset A flag indicating if deposit is in a third asset.
     * @param _priceOracle The address of the price oracle.
     * @return The amount of deposit assets is measured in borrowed assets.
     */
    function getDepositAmountInBorrowed(
        IDexAdapter.AmountParams calldata _params,
        bool _isThirdAsset,
        address payable _dexAdapter,
        address _priceOracle,
        bytes calldata _oracleData
    ) public returns (uint256) {
        _require(
            IERC165(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        if (_params.tokenA == _params.tokenB) {
            _require(_params.megaRoutes.length == 0, Errors.DEPOSITED_TO_BORROWED_ROUTES_LENGTH_SHOULD_BE_0.selector);
            return _params.amount;
        }

        uint256 depositAmountInBorrowed = IDexAdapter(_dexAdapter).getAmountOutByMegaRoutes(_params);
        if (_isThirdAsset) {
            uint256 oracleDepositAmountOut = getOracleAmountsOut(
                _params.tokenA,
                _params.tokenB,
                _params.amount,
                _priceOracle,
                _oracleData
            );
            if (depositAmountInBorrowed > oracleDepositAmountOut) depositAmountInBorrowed = oracleDepositAmountOut;
        }

        return depositAmountInBorrowed;
    }

    /**
     * @notice Performs a multi-hop swap transaction using the specified parameters.
     * @dev This function executes a series of token swaps on different DEXs based on the provided routes.
     * @param _params The struct containing all the necessary parameters for the multi-hop swap.
     * @param _maximumOracleTolerableLimit The maximum tolerable limit in WAD format (1 WAD = 100%)
     * for the price difference between DEX and the oracle.
     * @param _dexAdapter The address of the Dex adapter contract.
     * @param _priceOracle The address of the price oracle contract.
     * @param _needOracleTolerableLimitCheck Flag indicating whether to perform an oracle tolerable limit check.
     * @return The final balance of the _params.tokenB in the receiver's address after the multi-hop swap.
     */
    function megaSwap(
        MegaSwapParams calldata _params,
        uint256 _maximumOracleTolerableLimit,
        address payable _dexAdapter,
        address _priceOracle,
        bool _needOracleTolerableLimitCheck,
        bytes calldata _oracleData
    ) public returns (uint256) {
        uint256 balance = IERC20Metadata(_params.tokenB).balanceOf(_params.receiver);
        IDexAdapter(_dexAdapter).performMegaRoutesSwap(_params);

        balance = IERC20Metadata(_params.tokenB).balanceOf(_params.receiver) - balance;
        if (_needOracleTolerableLimitCheck) {
            _require(
                balance >=
                    getOracleAmountsOut(_params.tokenA, _params.tokenB, _params.amountTokenA, _priceOracle, _oracleData)
                        .wmul(WadRayMath.WAD - _maximumOracleTolerableLimit),
                Errors.DIFFERENT_PRICE_DEX_AND_ORACLE.selector
            );
        }

        return balance;
    }

    /**
     * @notice Pays the protocol fee.
     * @dev This function transfers the protocol fee from the trader to the protocol treasury.
     * @param params The parameters for paying the protocol fee.
     * @return feeInPaymentAsset The amount of the protocol fee in a payment asset
     * (position asset for the limit order execution, sold asset when the position is closed.)
     * @return feeInPmx The amount of the protocol fee in pmx asset paid.
     */
    function payProtocolFee(
        ProtocolFeeParams memory params
    ) public returns (uint256 feeInPaymentAsset, uint256 feeInPmx) {
        // This is done to ensure that after upgrading the contracts, positions that have already been opened
        // and had fees paid for them will not incur additional fees upon closure
        if (params.feeToken == address(0)) {
            return (0, 0);
        }

        ProtocolFeeVars memory vars;
        (vars.pmx, vars.treasury, , , vars.pmxDiscountMultiplier) = params.primexDNS.getPrimexDNSParams(
            params.feeRateType
        );
        feeInPaymentAsset = calculateFeeInPaymentAsset(
            CalculateFeeInPaymentAssetParams({
                primexDNS: params.primexDNS,
                priceOracle: params.priceOracle,
                feeRateType: params.feeRateType,
                paymentAsset: params.paymentAsset,
                paymentAmount: params.paymentAmount,
                keeperRewardDistributor: params.keeperRewardDistributor,
                gasSpent: params.gasSpent,
                isFeeProhibitedInPmx: params.isFeeProhibitedInPmx,
                nativePaymentAssetOracleData: params.nativePaymentAssetOracleData
            })
        );
        (vars.pmxTraderBalance, ) = params.traderBalanceVault.balances(params.trader, vars.pmx);
        if (params.feeToken == vars.pmx && vars.pmxTraderBalance > 0 && !params.isFeeProhibitedInPmx) {
            // pmx => payment asset data
            uint256 pmxTraderBalanceInPaymentAsset = getOracleAmountsOut(
                vars.pmx,
                params.paymentAsset,
                vars.pmxTraderBalance,
                params.priceOracle,
                params.pmxPaymentAssetOracleData
            );

            uint256 feeInPaymentAssetWithDiscount = feeInPaymentAsset.wmul(vars.pmxDiscountMultiplier);

            feeInPmx = (feeInPaymentAssetWithDiscount * vars.pmxTraderBalance) / pmxTraderBalanceInPaymentAsset;

            if (pmxTraderBalanceInPaymentAsset >= feeInPaymentAssetWithDiscount) {
                feeInPaymentAsset = 0;
                params.traderBalanceVault.withdrawFrom(params.trader, vars.treasury, vars.pmx, feeInPmx, false);
            } else {
                feeInPmx = vars.pmxTraderBalance;
                feeInPaymentAsset -= pmxTraderBalanceInPaymentAsset.wdiv(vars.pmxDiscountMultiplier);
                params.traderBalanceVault.withdrawFrom(
                    params.trader,
                    vars.treasury,
                    vars.pmx,
                    vars.pmxTraderBalance,
                    false
                );
                TokenTransfersLibrary.doTransferOut(params.paymentAsset, vars.treasury, feeInPaymentAsset);
            }
        } else {
            TokenTransfersLibrary.doTransferOut(params.paymentAsset, vars.treasury, feeInPaymentAsset);
        }
    }

    /**
     * @notice Calculate and return protocol fee
     * @return The amount of the protocol fee in '_feeToken' which needs to be paid according to the specified deposit parameters.
     */
    function calculateFeeInPaymentAsset(CalculateFeeInPaymentAssetParams memory params) public returns (uint256) {
        FeeInPaymentAssetVars memory vars;
        (, , vars.protocolFeeRate, vars.maxProtocolFee, ) = params.primexDNS.getPrimexDNSParams(params.feeRateType);
        // Calculate protocol fee in position asset
        vars.feeInPaymentAsset = params.paymentAmount.wmul(vars.protocolFeeRate);

        // Calculate max protocol fee in position asset
        vars.maxProtocolFeeInPaymentAsset = vars.maxProtocolFee == type(uint256).max
            ? type(uint256).max
            : getOracleAmountsOut(
                NATIVE_CURRENCY,
                params.paymentAsset,
                vars.maxProtocolFee,
                params.priceOracle,
                params.nativePaymentAssetOracleData
            );

        // The minProtocolFee is applied only if the order/position is processed by Keepers

        if (
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByTrader ||
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.SpotPositionClosedByTrader ||
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.SwapMarketOrder
        ) {
            vars.feeInPaymentAsset = min(vars.feeInPaymentAsset, vars.maxProtocolFeeInPaymentAsset);
        } else {
            vars.minProtocolFeeInPaymentAsset = minProtocolFee(
                MinProtocolFeeParams({
                    restrictedGasSpent: params.gasSpent,
                    paymentAsset: params.paymentAsset,
                    priceOracle: params.priceOracle,
                    keeperRewardDistributor: IKeeperRewardDistributorV3(params.keeperRewardDistributor),
                    primexDNS: params.primexDNS,
                    isFeeProhibitedInPmx: params.isFeeProhibitedInPmx,
                    feeRateType: params.feeRateType,
                    nativePaymentAssetOracleData: params.nativePaymentAssetOracleData
                })
            );
            _require(
                vars.minProtocolFeeInPaymentAsset < params.paymentAmount,
                Errors.MIN_PROTOCOL_FEE_IS_GREATER_THAN_PAYMENT_AMOUNT.selector
            );

            vars.feeInPaymentAsset = min(
                max(vars.feeInPaymentAsset, vars.minProtocolFeeInPaymentAsset),
                vars.maxProtocolFeeInPaymentAsset
            );
        }
        return vars.feeInPaymentAsset;
    }

    function payProtocolFeeBatchClose(
        ProtocolFeeParamsBatchClose calldata params
    ) public returns (uint256[] memory, uint256[] memory) {
        ProtocolFeeVars memory vars;
        uint256[] memory feeInPaymentAsset = new uint256[](params.numberOfPositions);
        uint256[] memory feeInPmx = new uint256[](params.numberOfPositions);

        (vars.pmx, vars.treasury, , , vars.pmxDiscountMultiplier) = params.primexDNS.getPrimexDNSParams(
            params.feeRateType
        );
        feeInPaymentAsset = calculateFeeInPaymentAssetBatchClose(
            params.numberOfPositions,
            params.primexDNS,
            params.priceOracle,
            params.feeRateType,
            params.paymentAsset,
            params.paymentAmounts,
            params.keeperRewardDistributor,
            params.estimatedGasAmount,
            params.estimatedBaseLength,
            params.nativePaymentAssetOracleData
        );
        for (uint256 i; i < params.numberOfPositions; i++) {
            // This is done to ensure that after upgrading the contracts, positions that have already been opened
            // and had fees paid for them will not incur additional fees upon closure
            if (params.feeTokens[i] == address(0)) {
                feeInPaymentAsset[i] = 0;
                feeInPmx[i] = 0;
                continue;
            }

            (vars.pmxTraderBalance, ) = params.traderBalanceVault.balances(params.traders[i], vars.pmx);

            if (!params.isFeeProhibitedInPmx && params.feeTokens[i] == vars.pmx && vars.pmxTraderBalance > 0) {
                vars.pmxTraderBalanceInPaymentAsset = getOracleAmountsOut(
                    vars.pmx,
                    params.paymentAsset,
                    vars.pmxTraderBalance,
                    params.priceOracle,
                    params.pmxPaymentAssetOracleData
                );

                vars.feeInPaymentAssetWithDiscount = feeInPaymentAsset[i].wmul(vars.pmxDiscountMultiplier);
                feeInPmx[i] =
                    (vars.feeInPaymentAssetWithDiscount * vars.pmxTraderBalance) /
                    vars.pmxTraderBalanceInPaymentAsset;
                if (vars.pmxTraderBalanceInPaymentAsset >= vars.feeInPaymentAssetWithDiscount) {
                    feeInPaymentAsset[i] = 0;
                    params.traderBalanceVault.withdrawFrom(
                        params.traders[i],
                        vars.treasury,
                        vars.pmx,
                        feeInPmx[i],
                        false
                    );
                } else {
                    feeInPmx[i] = vars.pmxTraderBalance;
                    feeInPaymentAsset[i] -= vars.pmxTraderBalanceInPaymentAsset.wdiv(vars.pmxDiscountMultiplier);
                    params.traderBalanceVault.withdrawFrom(
                        params.traders[i],
                        vars.treasury,
                        vars.pmx,
                        vars.pmxTraderBalance,
                        false
                    );
                }
            }
        }
        return (feeInPaymentAsset, feeInPmx);
    }

    /**
     * @notice Calculate and return protocol fee
     * @return The amount of the protocol fee in '_feeToken' which needs to be paid according to the specified deposit parameters.
     */
    function calculateFeeInPaymentAssetBatchClose(
        uint256 numberOfPositions,
        IPrimexDNSV3 primexDNS,
        address priceOracle,
        IPrimexDNSStorageV3.FeeRateType feeRateType,
        address paymentAsset,
        uint256[] memory paymentAmounts,
        address keeperRewardDistributor,
        uint256 estimatedGasAmount,
        uint256 estimatedBaseLength,
        bytes calldata _nativePaymentAssetOracleData
    ) public returns (uint256[] memory) {
        CalculateFeeInPaymentAssetBatchCloseVars memory vars;
        (, , vars.protocolFeeRate, vars.maxProtocolFee, ) = primexDNS.getPrimexDNSParams(feeRateType);
        // Calculate max protocol fee in payment (sold) asset
        vars.maxProtocolFeeInPaymentAsset = vars.maxProtocolFee == type(uint256).max
            ? type(uint256).max
            : getOracleAmountsOut(
                NATIVE_CURRENCY,
                paymentAsset,
                vars.maxProtocolFee,
                priceOracle,
                _nativePaymentAssetOracleData
            );

        vars.minProtocolFeeInPaymentAsset = minProtocolFeeCloseBatch(
            paymentAsset,
            priceOracle,
            IKeeperRewardDistributorV3(keeperRewardDistributor),
            estimatedGasAmount,
            estimatedBaseLength,
            _nativePaymentAssetOracleData
        );

        vars.feeInPaymentAsset = new uint256[](numberOfPositions);
        // Calculate protocol fee in position asset
        for (uint256 i; i < numberOfPositions; i++) {
            vars.feeInPaymentAsset[i] = paymentAmounts[i].wmul(vars.protocolFeeRate);
            _require(
                vars.minProtocolFeeInPaymentAsset < paymentAmounts[i],
                Errors.MIN_PROTOCOL_FEE_IS_GREATER_THAN_PAYMENT_AMOUNT.selector
            );
            vars.feeInPaymentAsset[i] = min(
                max(vars.feeInPaymentAsset[i], vars.minProtocolFeeInPaymentAsset),
                vars.maxProtocolFeeInPaymentAsset
            );
        }

        return vars.feeInPaymentAsset;
    }

    /**
     * @notice Calculate minProtocolFee based on the gas price
     */
    function minProtocolFee(MinProtocolFeeParams memory params) public returns (uint256 minProtocolFeeInPositionAsset) {
        MinProtocolFeeVars memory vars;
        (vars.restrictedGasPrice) = calculateRestrictedGasPrice(params.priceOracle, params.keeperRewardDistributor);
        if (
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByKeeper ||
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.SpotPositionClosedByKeeper
        ) {
            vars.callingMethod = IPrimexDNSStorageV3.CallingMethod.ClosePositionByCondition;
        } else {
            vars.callingMethod = IPrimexDNSStorageV3.CallingMethod.OpenPositionByOrder;
        }
        (
            vars.liquidationGasAmount,
            vars.protocolFeeCoefficient,
            vars.additionalGasSpent,
            vars.maxGasAmount,
            vars.baseLength
        ) = params.primexDNS.getParamsForMinProtocolFee(vars.callingMethod);

        vars.l1CostWei = _calculateL1CostWei(vars.baseLength, params.keeperRewardDistributor);

        if (params.isFeeProhibitedInPmx) {
            vars.minProtocolFeeInNativeAsset =
                vars.liquidationGasAmount *
                vars.restrictedGasPrice +
                vars.l1CostWei +
                vars.protocolFeeCoefficient;
        } else {
            if (vars.callingMethod == IPrimexDNSStorageV3.CallingMethod.ClosePositionByCondition) {
                vars.minProtocolFeeInNativeAsset =
                    vars.maxGasAmount *
                    vars.restrictedGasPrice +
                    vars.l1CostWei +
                    vars.protocolFeeCoefficient;
            } else {
                vars.totalGasSpent = params.restrictedGasSpent + vars.additionalGasSpent;
                vars.totalGasSpent = min(vars.totalGasSpent, vars.maxGasAmount);

                vars.minProtocolFeeInNativeAsset =
                    vars.totalGasSpent *
                    vars.restrictedGasPrice +
                    vars.l1CostWei +
                    vars.protocolFeeCoefficient;
            }
        }
        minProtocolFeeInPositionAsset = getOracleAmountsOut(
            NATIVE_CURRENCY,
            params.paymentAsset,
            vars.minProtocolFeeInNativeAsset,
            params.priceOracle,
            params.nativePaymentAssetOracleData
        );
    }

    /**
     * @notice Calculate minProtocolFee based on the gas price in closeBatchPositions
     */
    function minProtocolFeeCloseBatch(
        address _paymentAsset,
        address _priceOracle,
        IKeeperRewardDistributorV3 _keeperRewardDistributor,
        uint256 _estimatedGasAmount,
        uint256 _estimatedBaseLength,
        bytes calldata _nativePaymentAssetOracleData
    ) public returns (uint256 minProtocolFeeInPositionAsset) {
        uint256 restrictedGasPrice = calculateRestrictedGasPrice(_priceOracle, _keeperRewardDistributor);

        uint256 l1CostWei = _calculateL1CostWei(_estimatedBaseLength, _keeperRewardDistributor);

        uint256 minProtocolFeeInNativeAsset = _estimatedGasAmount * restrictedGasPrice + l1CostWei;

        minProtocolFeeInPositionAsset = getOracleAmountsOut(
            NATIVE_CURRENCY,
            _paymentAsset,
            minProtocolFeeInNativeAsset,
            _priceOracle,
            _nativePaymentAssetOracleData
        );
    }

    /**
     * @notice Calculate minPositionSize based on the gas price
     */
    function minPositionSize(
        address _priceOracle,
        IKeeperRewardDistributorV3 _keeperRewardDistributor,
        IPrimexDNSV3 _primexDNS,
        IPrimexDNSStorageV3.TradingOrderType _tradingOrderType
    ) public view returns (uint256 minPositionSizeInNativeAsset) {
        uint256 restrictedGasPrice = calculateRestrictedGasPrice(_priceOracle, _keeperRewardDistributor);

        uint256 l1CostWei = _calculateL1CostWei(
            _primexDNS.getL1BaseLengthForTradingOrderType(_tradingOrderType),
            _keeperRewardDistributor
        );

        minPositionSizeInNativeAsset = (_primexDNS.averageGasPerAction(_tradingOrderType) *
            restrictedGasPrice +
            l1CostWei).wmul(_primexDNS.gasPriceBuffer());
    }

    function calculateRestrictedGasPrice(
        address _priceOracle,
        IKeeperRewardDistributorV3 _keeperRewardDistributor
    ) internal view returns (uint256 restrictedGasPrice) {
        RestrictedGasPriceVars memory vars;
        restrictedGasPrice = tx.gasprice;
        vars.oracleGasPrice = IPriceOracle(_priceOracle).getGasPrice();
        (vars.oracleGasPriceTolerance, vars.defaultMaxGasPrice, , ) = _keeperRewardDistributor
            .getGasCalculationParams();

        vars.maxGasPrice = vars.oracleGasPrice > 0
            ? uint256(vars.oracleGasPrice).wmul(WadRayMath.WAD + vars.oracleGasPriceTolerance)
            : vars.defaultMaxGasPrice;

        if (restrictedGasPrice > vars.maxGasPrice || restrictedGasPrice == 0) {
            restrictedGasPrice = vars.maxGasPrice;
        }
    }

    function getOracleAmountsOut(
        address _tokenA,
        address _tokenB,
        uint256 _amountAssetA,
        address _priceOracle,
        bytes memory _oracleData
    ) public returns (uint256) {
        _require(
            IERC165(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        if (_tokenA == _tokenB) {
            return _amountAssetA;
        }
        uint256 exchangeRate = IPriceOracleV2(_priceOracle).getExchangeRate(_tokenA, _tokenB, _oracleData);
        return (_amountAssetA * _getAssetMultiplier(_tokenA)).wmul(exchangeRate) / _getAssetMultiplier(_tokenB);
    }

    /**
     * @param _tokenA asset for sell
     * @param _tokenB asset to buy
     * @param _amountsAssetA An array of amounts of tokenA to sell
     * @param _priceOracle PriceOracle contract address
     * @return returns an array of amounts of `tokenB` by the `amountsAssetA` by the price of the oracle
     */
    function getBatchOracleAmountsOut(
        address _tokenA,
        address _tokenB,
        uint256[] memory _amountsAssetA,
        address _priceOracle,
        bytes calldata _oracleData
    ) public returns (uint256[] memory) {
        _require(
            IERC165(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        if (_tokenA == _tokenB) {
            return _amountsAssetA;
        }
        uint256[] memory amountsAssetB = new uint256[](_amountsAssetA.length);
        uint256 exchangeRate = IPriceOracleV2(_priceOracle).getExchangeRate(_tokenA, _tokenB, _oracleData);
        uint256 multiplier1 = 10 ** (18 - IERC20Metadata(_tokenA).decimals());
        uint256 multiplier2 = 10 ** (18 - IERC20Metadata(_tokenB).decimals());
        for (uint256 i; i < _amountsAssetA.length; i++) {
            amountsAssetB[i] = (_amountsAssetA[i] * multiplier1).wmul(exchangeRate) / multiplier2;
        }
        return amountsAssetB;
    }

    /**
     * @notice Calculates the liquidation price for a position.
     * @dev liquidationPrice = (feeBuffer * debt) /
     * ((1 - securityBuffer) * (1 - oracleTolerableLimit) * (1 - priceDrop) * positionAmount))
     * @param _bucket The address of the related bucket.
     * @param _positionAsset The address of the position asset.
     * @param _positionAmount The size of the opened position.
     * @param _positionDebt The debt amount in debtTokens associated with the position.
     * @return The calculated liquidation price in borrowed asset.
     */
    function getLiquidationPrice(
        address _bucket,
        address _positionAsset,
        uint256 _positionAmount,
        uint256 _positionDebt,
        address _primexDNS
    ) public view returns (uint256) {
        _require(_positionAsset != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        LiquidationPriceData memory data;
        data.bucket = IBucketV3(_bucket);
        data.positionManager = data.bucket.positionManager();
        data.borrowedAsset = data.bucket.borrowedAsset();
        data.priceOracle = data.positionManager.priceOracle();

        uint256 multiplier1 = 10 ** (18 - data.borrowedAsset.decimals());
        uint256 denominator = (WadRayMath.WAD - data.positionManager.securityBuffer())
            .wmul(
                WadRayMath.WAD -
                    data.positionManager.getOracleTolerableLimit(_positionAsset, address(data.borrowedAsset))
            )
            .wmul(WadRayMath.WAD - data.priceOracle.getPairPriceDrop(_positionAsset, address(data.borrowedAsset)))
            .wmul(_positionAmount)
            .wmul(
                WadRayMath.WAD -
                    IPrimexDNSV3(_primexDNS).protocolFeeRates(
                        IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByKeeper
                    )
            ) * 10 ** (18 - IERC20Metadata(_positionAsset).decimals());
        // numerator = data.bucket.feeBuffer().wmul(_positionDebt) * multiplier1;
        return (data.bucket.feeBuffer().wmul(_positionDebt) * multiplier1).wdiv(denominator) / multiplier1;
    }

    /**
     * @notice Validates if a position meets the minimum size requirement.
     * @param _amount The amount of the asset in the position.
     * @param _asset The asset associated with the position.
     * @param _priceOracle The address of the price oracle contract.
     * @param _nativeAssetOracleData NativeCurrency => Asset
     */
    function validateMinPositionSize(
        uint256 _amount,
        address _asset,
        address _priceOracle,
        IKeeperRewardDistributorV3 _keeperRewardDistributor,
        IPrimexDNSV3 _primexDNS,
        IPrimexDNSStorageV3.TradingOrderType _tradingOrderType,
        bytes calldata _nativeAssetOracleData
    ) public {
        _require(
            isGreaterThanMinPositionSize(
                _asset,
                _amount,
                _priceOracle,
                _keeperRewardDistributor,
                _primexDNS,
                _tradingOrderType,
                _nativeAssetOracleData
            ),
            Errors.INSUFFICIENT_POSITION_SIZE.selector
        );
    }

    /**
     * @notice Checks if the given amount of _asset corresponds to the minimum position size _minPositionSize,
     * based on the _minPositionAsset and the provided _priceOracle.
     * Returns true if the amount corresponds to or exceeds the minimum position size, otherwise returns false.
     * @param _asset The address of the asset being checked.
     * @param _amount The amount of _asset being checked.
     * @param _priceOracle The address of the price oracle contract.
     * @return A boolean value indicating whether the amount corresponds to or exceeds the minimum position size.
     */
    function isGreaterThanMinPositionSize(
        address _asset,
        uint256 _amount,
        address _priceOracle,
        IKeeperRewardDistributorV3 _keeperRewardDistributor,
        IPrimexDNSV3 _primexDNS,
        IPrimexDNSStorageV3.TradingOrderType _tradingOrderType,
        bytes calldata _nativeAssetOracleData
    ) public returns (bool) {
        uint256 minPositionSizeInNativeCurrency = minPositionSize(
            _priceOracle,
            _keeperRewardDistributor,
            _primexDNS,
            _tradingOrderType
        );
        uint256 minPositionSizeInAsset = getOracleAmountsOut(
            NATIVE_CURRENCY,
            _asset,
            minPositionSizeInNativeCurrency,
            _priceOracle,
            _nativeAssetOracleData
        );
        return _amount >= minPositionSizeInAsset;
    }

    /**
     * @notice Decodes an encoded path and returns an array of addresses.
     * @param encodedPath The encoded path to be decoded.
     * @param dexRouter The address of the DEX router.
     * @param dexAdapter The address of the DEX adapter.
     * @return path An array of addresses representing the decoded path.
     */
    function decodePath(
        bytes memory encodedPath,
        address dexRouter,
        address payable dexAdapter
    ) public view returns (address[] memory path) {
        IDexAdapter.DexType type_ = IDexAdapter(dexAdapter).dexType(dexRouter);

        if (type_ == IDexAdapter.DexType.UniswapV2 || type_ == IDexAdapter.DexType.Meshswap) {
            path = abi.decode(encodedPath, (address[]));
        } else if (type_ == IDexAdapter.DexType.UniswapV3) {
            uint256 skip;
            uint256 offsetSize = 23; // address size(20) + fee size(3)
            uint256 pathLength = encodedPath.length / offsetSize + 1;
            path = new address[](pathLength);
            for (uint256 i; i < pathLength; i++) {
                path[i] = encodedPath.toAddress(skip, encodedPath.length);
                skip += offsetSize;
            }
        } else if (type_ == IDexAdapter.DexType.Curve) {
            (path, ) = abi.decode(encodedPath, (address[], address[]));
        } else if (type_ == IDexAdapter.DexType.Balancer) {
            (path, , ) = abi.decode(encodedPath, (address[], bytes32[], int256[]));
        } else if (type_ == IDexAdapter.DexType.AlgebraV3) {
            uint256 skip;
            uint256 offsetSize = 20; // address size(20)
            uint256 pathLength = encodedPath.length / offsetSize;
            path = new address[](pathLength);
            for (uint256 i; i < pathLength; i++) {
                path[i] = encodedPath.toAddress(skip, encodedPath.length);
                skip += offsetSize;
            }
        } else {
            _revert(Errors.UNKNOWN_DEX_TYPE.selector);
        }
    }

    /**
     * @notice Returns the asset multiplier for a given asset.
     * @dev If the asset is the native currency, the function returns 1.
     * If the asset is USD, the function returns the value stored in the constant USD_MULTIPLIER.
     * For any other asset, the function calculates the multiplier based on the number of decimals of the token.
     * @param _asset The address of the asset.
     * @return The asset multiplier. It is a number with 10 raised to a power of decimals of a given asset.
     */
    function _getAssetMultiplier(address _asset) internal view returns (uint256) {
        if (_asset == NATIVE_CURRENCY) return 1;
        if (_asset == USD) return USD_MULTIPLIER;

        return 10 ** (18 - IERC20Metadata(_asset).decimals());
    }

    function _calculateL1CostWei(
        uint256 _baseLength,
        IKeeperRewardDistributorV3 _keeperRewardDistributor
    ) internal view returns (uint256 l1CostWei) {
        (
            ,
            ,
            uint256 optimisticGasCoefficient,
            IKeeperRewardDistributorStorage.PaymentModel paymentModel
        ) = _keeperRewardDistributor.getGasCalculationParams();
        if (paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM) {
            return
                l1CostWei =
                    ARB_NITRO_ORACLE.getL1BaseFeeEstimate() *
                    GAS_FOR_BYTE *
                    (_baseLength + TRANSACTION_METADATA_BYTES);
        }
        if (paymentModel == IKeeperRewardDistributorStorage.PaymentModel.OPTIMISTIC) {
            // Adds 68 bytes of padding to account for the fact that the input does not have a signature.
            uint256 l1GasUsed = GAS_FOR_BYTE * (_baseLength + OVM_GASPRICEORACLE.overhead() + 68);
            return
                l1CostWei =
                    (OVM_GASPRICEORACLE.l1BaseFee() *
                        l1GasUsed *
                        OVM_GASPRICEORACLE.scalar() *
                        optimisticGasCoefficient) /
                    10 ** 6;
        }
        return 0;
    }

    /**
     * @notice Utility function to get the minimum of two values
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @notice Utility function to get the maximum of two values
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
