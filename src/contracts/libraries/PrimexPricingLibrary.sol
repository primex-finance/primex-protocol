// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BytesLib} from "./utils/BytesLib.sol";
import {WadRayMath} from "./utils/WadRayMath.sol";

import {NATIVE_CURRENCY, USD, USD_MULTIPLIER, ARB_NITRO_ORACLE, GAS_FOR_BYTE, TRANSACTION_METADATA_BYTES} from "../Constants.sol";
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
     * @param feeToken An asset in which the fee will be paid. At this point it could be the pmx, the epmx or a native currency
     * @param trader trader address
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
        address positionAsset;
        uint256 positionSize;
        uint256 gasSpent;
        bool isFeeOnlyInPositionAsset;
        bytes pmxPositionAssetOracleData;
        bytes nativePositionAssetOracleData;
    }

    struct ProtocolFeeParamsBatchClose {
        uint256 numberOfPositions;
        address[] feeTokens;
        address[] traders;
        uint256[] positionSizes;
        address positionAsset;
        address priceOracle;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        ITraderBalanceVault traderBalanceVault;
        address keeperRewardDistributor;
        IPrimexDNSV3 primexDNS;
        uint256 estimatedGasAmount;
        bool isFeeOnlyInPositionAsset;
        uint256 estimatedBaseLength;
        bytes nativePositionAssetOracleData;
        bytes pmxPositionAssetOracleData;
    }

    struct CalculateFeeInPositionAssetParams {
        IPrimexDNSV3 primexDNS;
        address priceOracle;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        address positionAsset;
        uint256 positionSize;
        address keeperRewardDistributor;
        uint256 gasSpent;
        bool isFeeOnlyInPositionAsset;
        bytes nativePositionAssetOracleData;
    }

    struct MinProtocolFeeParams {
        uint256 restrictedGasSpent;
        address positionAsset;
        address priceOracle;
        IKeeperRewardDistributorV3 keeperRewardDistributor;
        IPrimexDNSV3 primexDNS;
        bool isFeeOnlyInPositionAsset;
        IPrimexDNSStorageV3.FeeRateType feeRateType;
        bytes nativePositionAssetOracleData;
    }

    /**
     * The struct for payProtocolFee function
     */
    struct ProtocolFeeVars {
        address pmx;
        address treasury;
        uint256 feeInPositionAssetWithDiscount;
        uint256 pmxTraderBalance;
        uint256 pmxTraderBalanceInPositionAsset;
        uint256 pmxDiscountMultiplier;
    }

    /**
     * The struct for calculateFeeInPositionAssetVars function
     */
    struct FeeInPositionAssetVars {
        uint256 protocolFeeRate;
        uint256 maxProtocolFee;
        uint256 feeInPositionAsset;
        uint256 maxProtocolFeeInPositionAsset;
        uint256 minProtocolFeeInPositionAsset;
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
        IPrimexDNSStorageV3.CallingMethod callingMethod;
        IKeeperRewardDistributorStorage.PaymentModel paymentModel;
    }

    /**
     * The struct for calculateFeeInPositionAssetBatchClose function
     */
    struct CalculateFeeInPositionAssetBatchCloseVars {
        uint256[] feeInPositionAsset;
        uint256 protocolFeeRate;
        uint256 maxProtocolFee;
        uint256 maxProtocolFeeInPositionAsset;
        uint256 minProtocolFeeInPositionAsset;
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
     * @return feeInPositionAsset The amount of the protocol fee in position asset paid.
     * @return feeInPmx The amount of the protocol fee in pmx asset paid.
     */
    function payProtocolFee(
        ProtocolFeeParams memory params
    ) public returns (uint256 feeInPositionAsset, uint256 feeInPmx) {
        // This is done to ensure that after upgrading the contracts, positions that have already been opened
        // and had fees paid for them will not incur additional fees upon closure
        if (params.feeToken == address(0)) {
            return (0, 0);
        }

        ProtocolFeeVars memory vars;
        (vars.pmx, vars.treasury, , , vars.pmxDiscountMultiplier) = params.primexDNS.getPrimexDNSParams(
            params.feeRateType
        );
        feeInPositionAsset = calculateFeeInPositionAsset(
            CalculateFeeInPositionAssetParams({
                primexDNS: params.primexDNS,
                priceOracle: params.priceOracle,
                feeRateType: params.feeRateType,
                positionAsset: params.positionAsset,
                positionSize: params.positionSize,
                keeperRewardDistributor: params.keeperRewardDistributor,
                gasSpent: params.gasSpent,
                isFeeOnlyInPositionAsset: params.isFeeOnlyInPositionAsset,
                nativePositionAssetOracleData: params.nativePositionAssetOracleData
            })
        );
        (vars.pmxTraderBalance, ) = params.traderBalanceVault.balances(params.trader, vars.pmx);
        if (params.feeToken == vars.pmx && vars.pmxTraderBalance > 0 && !params.isFeeOnlyInPositionAsset) {
            // pmx => position asset data
            uint256 pmxTraderBalanceInPositionAsset = getOracleAmountsOut(
                vars.pmx,
                params.positionAsset,
                vars.pmxTraderBalance,
                params.priceOracle,
                params.pmxPositionAssetOracleData
            );

            uint256 feeInPositionAssetWithDiscount = feeInPositionAsset.wmul(vars.pmxDiscountMultiplier);

            feeInPmx = (feeInPositionAssetWithDiscount * vars.pmxTraderBalance) / pmxTraderBalanceInPositionAsset;

            if (pmxTraderBalanceInPositionAsset >= feeInPositionAssetWithDiscount) {
                feeInPositionAsset = 0;
                params.traderBalanceVault.withdrawFrom(params.trader, vars.treasury, vars.pmx, feeInPmx, false);
            } else {
                feeInPmx = vars.pmxTraderBalance;
                feeInPositionAsset -= pmxTraderBalanceInPositionAsset.wdiv(vars.pmxDiscountMultiplier);
                params.traderBalanceVault.withdrawFrom(
                    params.trader,
                    vars.treasury,
                    vars.pmx,
                    vars.pmxTraderBalance,
                    false
                );
                TokenTransfersLibrary.doTransferOut(params.positionAsset, vars.treasury, feeInPositionAsset);
            }
        } else {
            TokenTransfersLibrary.doTransferOut(params.positionAsset, vars.treasury, feeInPositionAsset);
        }
    }

    /**
     * @notice Calculate and return protocol fee
     * @return The amount of the protocol fee in '_feeToken' which needs to be paid according to the specified deposit parameters.
     */
    function calculateFeeInPositionAsset(CalculateFeeInPositionAssetParams memory params) public returns (uint256) {
        FeeInPositionAssetVars memory vars;
        (, , vars.protocolFeeRate, vars.maxProtocolFee, ) = params.primexDNS.getPrimexDNSParams(params.feeRateType);
        // Calculate protocol fee in position asset
        vars.feeInPositionAsset = params.positionSize.wmul(vars.protocolFeeRate);

        // Calculate max protocol fee in position asset
        vars.maxProtocolFeeInPositionAsset = vars.maxProtocolFee == type(uint256).max
            ? type(uint256).max
            : getOracleAmountsOut(
                NATIVE_CURRENCY,
                params.positionAsset,
                vars.maxProtocolFee,
                params.priceOracle,
                params.nativePositionAssetOracleData
            );

        // The minProtocolFee is applied only if the order/position is processed by Keepers

        if (
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.MarginPositionClosedByTrader ||
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.SpotPositionClosedByTrader ||
            params.feeRateType == IPrimexDNSStorageV3.FeeRateType.SwapMarketOrder
        ) {
            vars.feeInPositionAsset = min(vars.feeInPositionAsset, vars.maxProtocolFeeInPositionAsset);
        } else {
            vars.minProtocolFeeInPositionAsset = minProtocolFee(
                MinProtocolFeeParams({
                    restrictedGasSpent: params.gasSpent,
                    positionAsset: params.positionAsset,
                    priceOracle: params.priceOracle,
                    keeperRewardDistributor: IKeeperRewardDistributorV3(params.keeperRewardDistributor),
                    primexDNS: params.primexDNS,
                    isFeeOnlyInPositionAsset: params.isFeeOnlyInPositionAsset,
                    feeRateType: params.feeRateType,
                    nativePositionAssetOracleData: params.nativePositionAssetOracleData
                })
            );
            _require(
                vars.minProtocolFeeInPositionAsset < params.positionSize,
                Errors.MIN_PROTOCOL_FEE_IS_GREATER_THAN_POSITION_SIZE.selector
            );

            vars.feeInPositionAsset = min(
                max(vars.feeInPositionAsset, vars.minProtocolFeeInPositionAsset),
                vars.maxProtocolFeeInPositionAsset
            );
        }
        return vars.feeInPositionAsset;
    }

    function payProtocolFeeBatchClose(
        ProtocolFeeParamsBatchClose calldata params
    ) public returns (uint256[] memory, uint256[] memory) {
        ProtocolFeeVars memory vars;
        uint256[] memory feeInPositionAsset = new uint256[](params.numberOfPositions);
        uint256[] memory feeInPmx = new uint256[](params.numberOfPositions);

        (vars.pmx, vars.treasury, , , vars.pmxDiscountMultiplier) = params.primexDNS.getPrimexDNSParams(
            params.feeRateType
        );
        feeInPositionAsset = calculateFeeInPositionAssetBatchClose(
            params.numberOfPositions,
            params.primexDNS,
            params.priceOracle,
            params.feeRateType,
            params.positionAsset,
            params.positionSizes,
            params.keeperRewardDistributor,
            params.estimatedGasAmount,
            params.estimatedBaseLength,
            params.nativePositionAssetOracleData
        );
        for (uint256 i; i < params.numberOfPositions; i++) {
            // This is done to ensure that after upgrading the contracts, positions that have already been opened
            // and had fees paid for them will not incur additional fees upon closure
            if (params.feeTokens[i] == address(0)) {
                feeInPositionAsset[i] = 0;
                feeInPmx[i] = 0;
                continue;
            }

            (vars.pmxTraderBalance, ) = params.traderBalanceVault.balances(params.traders[i], vars.pmx);

            if (!params.isFeeOnlyInPositionAsset && params.feeTokens[i] == vars.pmx && vars.pmxTraderBalance > 0) {
                vars.pmxTraderBalanceInPositionAsset = getOracleAmountsOut(
                    vars.pmx,
                    params.positionAsset,
                    vars.pmxTraderBalance,
                    params.priceOracle,
                    params.pmxPositionAssetOracleData
                );

                vars.feeInPositionAssetWithDiscount = feeInPositionAsset[i].wmul(vars.pmxDiscountMultiplier);
                feeInPmx[i] =
                    (vars.feeInPositionAssetWithDiscount * vars.pmxTraderBalance) /
                    vars.pmxTraderBalanceInPositionAsset;
                if (vars.pmxTraderBalanceInPositionAsset >= vars.feeInPositionAssetWithDiscount) {
                    feeInPositionAsset[i] = 0;
                    params.traderBalanceVault.withdrawFrom(
                        params.traders[i],
                        vars.treasury,
                        vars.pmx,
                        feeInPmx[i],
                        false
                    );
                } else {
                    feeInPmx[i] = vars.pmxTraderBalance;
                    feeInPositionAsset[i] -= vars.pmxTraderBalanceInPositionAsset.wdiv(vars.pmxDiscountMultiplier);
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
        return (feeInPositionAsset, feeInPmx);
    }

    /**
     * @notice Calculate and return protocol fee
     * @return The amount of the protocol fee in '_feeToken' which needs to be paid according to the specified deposit parameters.
     */
    function calculateFeeInPositionAssetBatchClose(
        uint256 numberOfPositions,
        IPrimexDNSV3 primexDNS,
        address priceOracle,
        IPrimexDNSStorageV3.FeeRateType feeRateType,
        address positionAsset,
        uint256[] memory positionSizes,
        address keeperRewardDistributor,
        uint256 estimatedGasAmount,
        uint256 estimatedBaseLength,
        bytes calldata _nativePositionAssetOracleData
    ) public returns (uint256[] memory) {
        CalculateFeeInPositionAssetBatchCloseVars memory vars;
        (, , vars.protocolFeeRate, vars.maxProtocolFee, ) = primexDNS.getPrimexDNSParams(feeRateType);
        // Calculate max protocol fee in position asset
        vars.maxProtocolFeeInPositionAsset = vars.maxProtocolFee == type(uint256).max
            ? type(uint256).max
            : getOracleAmountsOut(
                NATIVE_CURRENCY,
                positionAsset,
                vars.maxProtocolFee,
                priceOracle,
                _nativePositionAssetOracleData
            );

        vars.minProtocolFeeInPositionAsset = minProtocolFeeCloseBatch(
            positionAsset,
            priceOracle,
            IKeeperRewardDistributorV3(keeperRewardDistributor),
            estimatedGasAmount,
            estimatedBaseLength,
            _nativePositionAssetOracleData
        );
        vars.feeInPositionAsset = new uint256[](numberOfPositions);
        // Calculate protocol fee in position asset
        for (uint256 i; i < numberOfPositions; i++) {
            vars.feeInPositionAsset[i] = positionSizes[i].wmul(vars.protocolFeeRate);
            _require(
                vars.minProtocolFeeInPositionAsset < positionSizes[i],
                Errors.MIN_PROTOCOL_FEE_IS_GREATER_THAN_POSITION_SIZE.selector
            );
            vars.feeInPositionAsset[i] = min(
                max(vars.feeInPositionAsset[i], vars.minProtocolFeeInPositionAsset),
                vars.maxProtocolFeeInPositionAsset
            );
        }

        return vars.feeInPositionAsset;
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

        vars.paymentModel = params.keeperRewardDistributor.paymentModel();
        vars.l1CostWei = vars.paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM
            ? ARB_NITRO_ORACLE.getL1BaseFeeEstimate() * GAS_FOR_BYTE * (vars.baseLength + TRANSACTION_METADATA_BYTES)
            : 0;

        if (params.isFeeOnlyInPositionAsset) {
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
            params.positionAsset,
            vars.minProtocolFeeInNativeAsset,
            params.priceOracle,
            params.nativePositionAssetOracleData
        );
    }

    /**
     * @notice Calculate minProtocolFee based on the gas price in closeBatchPositions
     */
    function minProtocolFeeCloseBatch(
        address _positionAsset,
        address _priceOracle,
        IKeeperRewardDistributorV3 _keeperRewardDistributor,
        uint256 _estimatedGasAmount,
        uint256 _estimatedBaseLength,
        bytes calldata _nativePositionAssetOracleData
    ) public returns (uint256 minProtocolFeeInPositionAsset) {
        uint256 restrictedGasPrice = calculateRestrictedGasPrice(_priceOracle, _keeperRewardDistributor);

        IKeeperRewardDistributorStorage.PaymentModel paymentModel = _keeperRewardDistributor.paymentModel();
        uint256 l1CostWei = paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM
            ? ARB_NITRO_ORACLE.getL1BaseFeeEstimate() *
                GAS_FOR_BYTE *
                (_estimatedBaseLength + TRANSACTION_METADATA_BYTES)
            : 0;

        uint256 minProtocolFeeInNativeAsset = _estimatedGasAmount * restrictedGasPrice + l1CostWei;

        minProtocolFeeInPositionAsset = getOracleAmountsOut(
            NATIVE_CURRENCY,
            _positionAsset,
            minProtocolFeeInNativeAsset,
            _priceOracle,
            _nativePositionAssetOracleData
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

        IKeeperRewardDistributorStorage.PaymentModel paymentModel = _keeperRewardDistributor.paymentModel();

        uint256 l1CostWei = paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM
            ? ARB_NITRO_ORACLE.getL1BaseFeeEstimate() *
                GAS_FOR_BYTE *
                (_primexDNS.getArbitrumBaseLengthForTradingOrderType(_tradingOrderType) + TRANSACTION_METADATA_BYTES)
            : 0;

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
        (vars.oracleGasPriceTolerance, vars.defaultMaxGasPrice) = _keeperRewardDistributor.getGasCalculationParams();

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
        uint256 _positionDebt
    ) public view returns (uint256) {
        _require(_positionAsset != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        LiquidationPriceData memory data;
        data.bucket = IBucketV3(_bucket);

        (, bool tokenAllowed) = data.bucket.allowedAssets(_positionAsset);
        _require(tokenAllowed, Errors.TOKEN_NOT_SUPPORTED.selector);

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
            .wmul(_positionAmount) * 10 ** (18 - IERC20Metadata(_positionAsset).decimals());
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
     * @notice Retrieves the price from two price feeds.
     * @dev This function returns the price ratio between the base price and the quote price.
     * @param basePriceFeed The address of the base price feed (AggregatorV3Interface).
     * @param quotePriceFeed The address of the quote price feed (AggregatorV3Interface).
     * @param roundBaseFeed The round ID of the base price feed.
     * @param roundQuoteFeed The round ID of the quote price feed.
     * @param checkedTimestamp The timestamp used to filter relevant prices. Set to 0 to consider all prices.
     * @return The price ratio in WAD format between the base price and the quote price, and the timestamp of the latest price.
     */
    function getPriceFromFeeds(
        AggregatorV3Interface basePriceFeed,
        AggregatorV3Interface quotePriceFeed,
        uint80 roundBaseFeed,
        uint80 roundQuoteFeed,
        uint256 checkedTimestamp
    ) internal view returns (uint256, uint256) {
        (, int256 basePrice, , uint256 basePriceUpdatedAt, ) = basePriceFeed.getRoundData(roundBaseFeed);
        (, , , uint256 basePriceUpdatedAtNext, ) = basePriceFeed.getRoundData(roundBaseFeed + 1);
        // update to current timestamp if roundBaseFeed is last round
        if (basePriceUpdatedAtNext == 0) basePriceUpdatedAtNext = block.timestamp;

        (, int256 quotePrice, , uint256 quotePriceUpdatedAt, ) = quotePriceFeed.getRoundData(roundQuoteFeed);
        (, , , uint256 quotePriceUpdatedAtNext, ) = quotePriceFeed.getRoundData(roundQuoteFeed + 1);
        // update to current timestamp if roundQuoteFeed is last round
        if (quotePriceUpdatedAtNext == 0) quotePriceUpdatedAtNext = block.timestamp;

        _require(basePriceUpdatedAt > 0 && quotePriceUpdatedAt > 0, Errors.DATA_FOR_ROUND_DOES_NOT_EXIST.selector);

        // we work only with prices that were relevant after position creation
        _require(
            checkedTimestamp == 0 ||
                (basePriceUpdatedAtNext > checkedTimestamp && quotePriceUpdatedAtNext > checkedTimestamp),
            Errors.HIGH_PRICE_TIMESTAMP_IS_INCORRECT.selector
        );
        // there should be an intersection between their duration
        _require(
            quotePriceUpdatedAt < basePriceUpdatedAtNext && basePriceUpdatedAt < quotePriceUpdatedAtNext,
            Errors.NO_PRICE_FEED_INTERSECTION.selector
        );
        //the return value will always be 18 decimals if the basePrice and quotePrice have the same decimals
        return (
            uint256(basePrice).wdiv(uint256(quotePrice)),
            quotePriceUpdatedAt < basePriceUpdatedAt ? quotePriceUpdatedAt : basePriceUpdatedAt
        );
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
