// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";
import {SwapManagerStorage, IERC165Upgradeable} from "./SwapManagerStorage.sol";
import {SMALL_TIMELOCK_ADMIN, BIG_TIMELOCK_ADMIN, EMERGENCY_ADMIN, NO_FEE_ROLE, LOM_ROLE, NATIVE_CURRENCY, USD} from "../Constants.sol";
import "../libraries/Errors.sol";

import {ISwapManager, IPausable} from "./ISwapManager.sol";
import {IPrimexDNSV3, IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNS.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

contract SwapManager is ISwapManager, SwapManagerStorage {
    using WadRayMath for uint256;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(registry.hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @dev Modifier to check if the sender is not blacklisted.
     */
    modifier notBlackListed() {
        _require(!whiteBlackList.isBlackListed(msg.sender), Errors.SENDER_IS_BLACKLISTED.selector);
        _;
    }

    /**
     * @inheritdoc ISwapManager
     */
    function initialize(address _registry) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = IAccessControl(_registry);
    }

    function initializeAfterUpgrade(
        address _primexDNS,
        address payable _traderBalanceVault,
        address _priceOracle,
        address _whiteBlackList
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) reinitializer(2) {
        _require(
            IERC165Upgradeable(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165Upgradeable(_traderBalanceVault).supportsInterface(type(ITraderBalanceVault).interfaceId) &&
                IERC165Upgradeable(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        primexDNS = IPrimexDNSV3(_primexDNS);
        traderBalanceVault = ITraderBalanceVault(_traderBalanceVault);
        priceOracle = IPriceOracleV2(_priceOracle);
    }

    /**
     * @inheritdoc ISwapManager
     */
    function swap(
        SwapParams calldata params,
        uint256 maximumOracleTolerableLimit,
        bool needOracleTolerableLimitCheck
    ) external payable override nonReentrant notBlackListed whenNotPaused returns (uint256) {
        bool isZeroFee = registry.hasRole(NO_FEE_ROLE, msg.sender);
        address payable dexAdapter = payable(address(primexDNS.dexAdapter()));
        if (params.isSwapFromWallet) {
            TokenTransfersLibrary.doTransferFromTo(params.tokenA, msg.sender, dexAdapter, params.amountTokenA);
        } else {
            traderBalanceVault.useTraderAssets(
                ITraderBalanceVault.LockAssetParams({
                    trader: msg.sender,
                    depositReceiver: dexAdapter,
                    depositAsset: params.tokenA,
                    depositAmount: params.amountTokenA,
                    openType: ITraderBalanceVault.OpenType.OPEN
                })
            );
        }

        uint256 amountOut = PrimexPricingLibrary.megaSwap(
            PrimexPricingLibrary.MegaSwapParams({
                tokenA: params.tokenA,
                tokenB: params.tokenB,
                amountTokenA: params.amountTokenA,
                megaRoutes: params.megaRoutes,
                receiver: address(this),
                deadline: params.deadline
            }),
            maximumOracleTolerableLimit,
            dexAdapter,
            address(priceOracle),
            isZeroFee && needOracleTolerableLimitCheck,
            params.tokenAtokenBOracleData
        );
        _require(amountOut >= params.amountOutMin, Errors.SLIPPAGE_TOLERANCE_EXCEEDED.selector);

        if (!isZeroFee) {
            if (
                primexDNS.getProtocolFeeRateByTier(
                    IPrimexDNSStorageV3.FeeRateType.SwapMarketOrder,
                    primexDNS.tiersManager().getTraderTierForAddress(msg.sender)
                ) != 0
            ) {
                priceOracle.updatePullOracle{value: msg.value}(params.pullOracleData, params.pullOracleTypes);
                uint256 feeInPositionAsset;
                uint256 feeInPmx;
                address feeToken;

                if (params.isSwapFeeInPmx) {
                    feeToken = primexDNS.pmx();
                } else {
                    feeToken = params.tokenB;
                }

                (feeInPositionAsset, feeInPmx) = PrimexPricingLibrary.payProtocolFee(
                    PrimexPricingLibrary.ProtocolFeeParams({
                        feeToken: feeToken,
                        trader: msg.sender,
                        priceOracle: address(priceOracle),
                        feeRateType: IPrimexDNSStorageV3.FeeRateType.SwapMarketOrder,
                        traderBalanceVault: traderBalanceVault,
                        swapManager: address(0),
                        keeperRewardDistributor: address(0),
                        primexDNS: primexDNS,
                        paymentAsset: params.tokenB,
                        paymentAmount: amountOut,
                        gasSpent: 0,
                        isFeeProhibitedInPmx: false,
                        pmxPaymentAssetOracleData: params.pmxPositionAssetOracleData,
                        nativePaymentAssetOracleData: params.nativePositionAssetOracleData
                    })
                );
                amountOut -= feeInPositionAsset;
                emit PaidProtocolFee({
                    trader: msg.sender,
                    boughtAsset: params.tokenB,
                    feeRateType: IPrimexDNSStorageV3.FeeRateType.SwapMarketOrder,
                    feeInPositionAsset: feeInPositionAsset,
                    feeInPmx: feeInPmx
                });
            }
        }

        if (params.isSwapToWallet) {
            TokenTransfersLibrary.doTransferOut(params.tokenB, params.receiver, amountOut);
        } else {
            TokenTransfersLibrary.doTransferOut(params.tokenB, address(traderBalanceVault), amountOut);
            traderBalanceVault.topUpAvailableBalance(params.receiver, params.tokenB, amountOut);
        }
        emit SpotSwap({
            trader: msg.sender,
            receiver: params.receiver,
            tokenA: params.tokenA,
            tokenB: params.tokenB,
            amountSold: params.amountTokenA,
            amountBought: amountOut
        });
        return amountOut;
    }

    /**
     * @inheritdoc ISwapManager
     */
    function swapInLimitOrder(
        SwapInLimitOrderParams calldata params,
        uint256 maximumOracleTolerableLimit
    ) external override whenNotPaused onlyRole(LOM_ROLE) returns (uint256, uint256) {
        address payable dexAdapter = payable(address(primexDNS.dexAdapter()));
        traderBalanceVault.useTraderAssets(
            ITraderBalanceVault.LockAssetParams({
                trader: msg.sender,
                depositReceiver: dexAdapter,
                depositAsset: params.depositAsset,
                depositAmount: params.depositAmount,
                openType: ITraderBalanceVault.OpenType.OPEN
            })
        );
        uint256 amountOut = PrimexPricingLibrary.megaSwap(
            PrimexPricingLibrary.MegaSwapParams({
                tokenA: params.depositAsset,
                tokenB: params.positionAsset,
                amountTokenA: params.depositAmount,
                megaRoutes: params.megaRoutes,
                receiver: address(this),
                deadline: params.deadline
            }),
            maximumOracleTolerableLimit,
            dexAdapter,
            address(priceOracle),
            false,
            params.depositPositionAssetOracleData
        );

        (uint256 feeInPositionAsset, uint256 feeInPmx) = PrimexPricingLibrary.payProtocolFee(
            PrimexPricingLibrary.ProtocolFeeParams({
                feeToken: params.feeToken,
                trader: params.trader,
                priceOracle: address(priceOracle),
                feeRateType: IPrimexDNSStorageV3.FeeRateType.SwapLimitOrderExecuted,
                traderBalanceVault: traderBalanceVault,
                swapManager: address(this),
                keeperRewardDistributor: params.keeperRewardDistributor,
                primexDNS: primexDNS,
                paymentAsset: params.positionAsset,
                paymentAmount: amountOut,
                gasSpent: params.gasSpent,
                isFeeProhibitedInPmx: false,
                pmxPaymentAssetOracleData: params.pmxPositionAssetOracleData,
                nativePaymentAssetOracleData: params.nativePositionAssetOracleData
            })
        );
        amountOut -= feeInPositionAsset;
        emit PaidProtocolFee({
            trader: msg.sender,
            boughtAsset: params.positionAsset,
            feeRateType: IPrimexDNSStorageV3.FeeRateType.SwapLimitOrderExecuted,
            feeInPositionAsset: feeInPositionAsset,
            feeInPmx: feeInPmx
        });

        TokenTransfersLibrary.doTransferOut(params.positionAsset, address(traderBalanceVault), amountOut);
        traderBalanceVault.topUpAvailableBalance(params.trader, params.positionAsset, amountOut);
        emit SpotSwap({
            trader: msg.sender,
            receiver: params.trader,
            tokenA: params.depositAsset,
            tokenB: params.positionAsset,
            amountSold: params.depositAmount,
            amountBought: amountOut
        });
        return (amountOut, feeInPositionAsset);
    }

    /**
     * @inheritdoc IPausable
     */
    function pause() external override onlyRole(EMERGENCY_ADMIN) {
        _pause();
    }

    /**
     * @inheritdoc IPausable
     */
    function unpause() external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _unpause();
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(ISwapManager).interfaceId || super.supportsInterface(_interfaceId);
    }
}
