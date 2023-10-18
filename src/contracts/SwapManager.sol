// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {WadRayMath} from "./libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "./libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "./libraries/TokenTransfersLibrary.sol";
import "./libraries/Errors.sol";

import {BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, NO_FEE_ROLE, NATIVE_CURRENCY} from "./Constants.sol";
import {ISwapManager} from "./interfaces/ISwapManager.sol";
import {ITraderBalanceVault} from "./TraderBalanceVault/ITraderBalanceVault.sol";
import {IPrimexDNS} from "./PrimexDNS/IPrimexDNS.sol";
import {IPrimexDNSStorage} from "./PrimexDNS/IPrimexDNSStorage.sol";
import {IPriceOracle} from "./PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "./WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPausable} from "./interfaces/IPausable.sol";

contract SwapManager is ISwapManager, ReentrancyGuard, Pausable, IERC165 {
    using WadRayMath for uint256;

    IAccessControl public immutable override registry;
    ITraderBalanceVault public immutable override traderBalanceVault;
    IPrimexDNS public immutable override primexDNS;
    IPriceOracle public immutable override priceOracle;
    IWhiteBlackList internal immutable whiteBlackList;

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @dev Modifier to check if the sender is not blacklisted.
     */
    modifier notBlackListed() {
        _require(!whiteBlackList.isBlackListed(msg.sender), Errors.SENDER_IS_BLACKLISTED.selector);
        _;
    }

    constructor(
        address _registry,
        address _primexDNS,
        address payable _traderBalanceVault,
        address _priceOracle,
        address _whiteBlackList
    ) {
        _require(
            IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165(address(_primexDNS)).supportsInterface(type(IPrimexDNS).interfaceId) &&
                IERC165(_traderBalanceVault).supportsInterface(type(ITraderBalanceVault).interfaceId) &&
                IERC165(_priceOracle).supportsInterface(type(IPriceOracle).interfaceId) &&
                IERC165(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        registry = IAccessControl(_registry);
        primexDNS = IPrimexDNS(_primexDNS);
        traderBalanceVault = ITraderBalanceVault(_traderBalanceVault);
        priceOracle = IPriceOracle(_priceOracle);
    }

    /**
     * @inheritdoc ISwapManager
     */
    function swap(
        SwapParams calldata params,
        uint256 maximumOracleTolerableLimit,
        bool needOracleTolerableLimitCheck
    ) external payable override nonReentrant notBlackListed whenNotPaused returns (uint256) {
        bool isFeeRole = registry.hasRole(NO_FEE_ROLE, msg.sender);
        if (!isFeeRole) {
            address feeToken = params.isSwapFeeInPmx ? primexDNS.pmx() : NATIVE_CURRENCY;
            PrimexPricingLibrary.payProtocolFee(
                PrimexPricingLibrary.ProtocolFeeParams({
                    depositData: PrimexPricingLibrary.DepositData({
                        protocolFee: 0,
                        depositAsset: params.tokenA,
                        depositAmount: params.amountTokenA,
                        leverage: WadRayMath.WAD
                    }),
                    feeToken: feeToken,
                    isSwapFromWallet: params.payFeeFromWallet,
                    calculateFee: true,
                    feeRate: primexDNS.feeRates(IPrimexDNSStorage.OrderType.SWAP_MARKET_ORDER, feeToken),
                    trader: msg.sender,
                    priceOracle: address(priceOracle),
                    traderBalanceVault: traderBalanceVault,
                    primexDNS: primexDNS
                })
            );
        }
        address dexAdapter = address(primexDNS.dexAdapter());
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

        uint256 amountOut = PrimexPricingLibrary.multiSwap(
            PrimexPricingLibrary.MultiSwapParams({
                tokenA: params.tokenA,
                tokenB: params.tokenB,
                amountTokenA: params.amountTokenA,
                routes: params.routes,
                dexAdapter: dexAdapter,
                receiver: params.isSwapToWallet ? params.receiver : address(traderBalanceVault),
                deadline: params.deadline
            }),
            maximumOracleTolerableLimit,
            address(primexDNS),
            address(priceOracle),
            isFeeRole && needOracleTolerableLimitCheck
        );
        _require(amountOut >= params.amountOutMin, Errors.SLIPPAGE_TOLERANCE_EXCEEDED.selector);

        if (!params.isSwapToWallet) {
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
        return _interfaceId == type(IERC165).interfaceId || _interfaceId == type(ISwapManager).interfaceId;
    }
}
