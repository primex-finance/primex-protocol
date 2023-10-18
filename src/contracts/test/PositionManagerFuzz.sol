// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;
import {PositionManager} from "../PositionManager/PositionManager.sol";
import {IPositionManager} from "../PositionManager/IPositionManager.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import {IERC20Mock} from "../interfaces/IERC20Mock.sol";
import {IBucket} from "../Bucket/IBucket.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {IPriceOracle} from "../PriceOracle/IPriceOracle.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPriceFeedUpdaterTestService} from "../interfaces/IPriceFeedUpdaterTestService.sol";
import {PrimexAggregatorV3TestService} from "../TestnetServices/PrimexAggregatorV3TestService.sol";
import {NATIVE_CURRENCY} from "../Constants.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";
import {IEPMXToken} from "../interfaces/IEPMXToken.sol";
import {IPrimexDNSStorage} from "../PrimexDNS/IPrimexDNSStorage.sol";

contract PositionManagerFuzz {
    /* solhint-disable */
    using WadRayMath for uint256;
    address constant randomAddress = 0x3Ce6356Cd31eDFd208eCe2CA515f264Fd90DD5AB;
    PositionManager internal pm;
    uint256 constant WAD = 10 ** 18;
    IERC20Mock internal depositToken;
    IERC20Mock internal epmx;
    IERC20Mock[4] internal tokensToBuy;
    uint256[4] internal decimals;
    uint256 internal depositTokenDecimals;
    IBucket internal bucket;
    IPriceOracle internal priceOracle;
    IDexAdapter internal dexAdapter;
    string[5] internal dexes;
    ITraderBalanceVault internal traderBalanceVault;
    IPriceFeedUpdaterTestService internal priceFeedUpdaterTestService;
    uint256 internal protocolRate;
    uint256 internal protocolRateInPmx;
    uint256 internal MIN_DEPOSIT_AMOUNT;
    uint256 internal MAX_DEPOSIT_AMOUNT;
    uint256 internal MIN_BORROWED_AMOUNT;
    uint256 internal MAX_BORROWED_AMOUNT;

    receive() external payable {}

    constructor() payable {
        pm = PositionManager(0xb581A901E74a160865c6D5DeEaa65eE0e4eD15E9);
        //usdc
        depositToken = IERC20Mock(0x871DD7C2B4b25E1Aa18728e9D5f2Af4C4e431f5c);
        bucket = IBucket(0x51A3F39ee1CA547b6D04B9A0a2358342b3a3F832);

        priceOracle = IPriceOracle(0xaE52826fC2AB091C026Cf8c919b76b3A4996fd8B);
        dexAdapter = IDexAdapter(0x786fE8061fBd5ECDe5fdc5fa03b4672F217880e6);
        // "weth", "wbtc", "link", "uni"
        tokensToBuy = [
            IERC20Mock(0x1dC4c1cEFEF38a777b15aA20260a54E584b16C48),
            IERC20Mock(0x1D7022f5B17d2F8B695918FB48fa1089C9f85401),
            IERC20Mock(0x0B1ba0af832d7C05fD64161E0Db78E85978E8082),
            IERC20Mock(0x48BaCB9266a570d521063EF5dD96e61686DbE788)
        ];
        decimals = [18, 8, 18, 18];
        depositTokenDecimals = 6;
        dexes = ["uniswap", "sushiswap", "uniswapv3", "quickswapv3", "meshswap"];
        priceFeedUpdaterTestService = IPriceFeedUpdaterTestService(0x538281ccF8aD9266e6e3f6C6077e122B1F56dBd6);
        MIN_DEPOSIT_AMOUNT = 1 * 10 ** depositTokenDecimals;
        MAX_DEPOSIT_AMOUNT = 10000 * 10 ** depositTokenDecimals;
        MIN_BORROWED_AMOUNT = 0;
        traderBalanceVault = ITraderBalanceVault(payable(0x1660b74302A5d34b2db784CAF456BD39C2D9942c));
        epmx = IERC20Mock(0xD1aE64401d65E9B0d1bF7E08Fbf75bb2F26eF70a);
        protocolRate = pm.primexDNS().feeRates(IPrimexDNSStorage.OrderType.MARKET_ORDER, address(0));
        protocolRateInPmx = pm.primexDNS().feeRates(IPrimexDNSStorage.OrderType.MARKET_ORDER, address(epmx));
    }

    struct SetCorrectOraclePriceParams {
        uint256 swapSize;
        string dex;
        address[] path;
        uint256 aTokenDecimals;
        uint256 bTokenDecimals;
    }

    struct LocalVars {
        uint256 depositAmount;
        uint256 borrowedAmount;
        address positionAsset;
        uint256 positionAssetDecimals;
        uint256 protocolFee;
        uint256 positionId;
        string dex;
        address[] path;
        uint256 closeAmount;
        PrimexPricingLibrary.Route[] routes;
        LimitOrderLibrary.Condition[] conditions;
    }

    struct OpenPositionParams {
        uint256 depositAmount;
        uint256 borrowedAmount;
        address depositAsset;
        address positionAsset;
        uint256 positionAssetDecimals;
        bool isProtocolFeeInPmx;
        bool takeDepositFromWallet;
        string dex;
    }

    function increaseDeposit_never_revert(
        uint40 _increaseAmountSeed,
        uint40 _depositAmountSeed,
        uint40 _borrowedAmountSeed,
        bool _takeDepositFromWallet,
        bool _isProtocolFeeInPmx
    ) public {
        LocalVars memory vars;
        vars.depositAmount = MIN_DEPOSIT_AMOUNT + (_depositAmountSeed % (MAX_DEPOSIT_AMOUNT - MIN_DEPOSIT_AMOUNT));
        (vars.positionAsset, vars.positionAssetDecimals) = _getRandomPositionAsset(0);
        MIN_BORROWED_AMOUNT = 1 * 10 ** depositTokenDecimals;
        //calculate max borrowed amount considering the maxAssetLeverage
        MAX_BORROWED_AMOUNT = bucket.maxAssetLeverage(vars.positionAsset).wmul(vars.depositAmount) - vars.depositAmount;
        vars.borrowedAmount = MIN_BORROWED_AMOUNT + (_borrowedAmountSeed % (MAX_BORROWED_AMOUNT - MIN_BORROWED_AMOUNT));
        //uniswap
        vars.dex = _getRandomDex(0);
        vars.positionId = _openValidPosition(
            OpenPositionParams(
                vars.depositAmount,
                vars.borrowedAmount,
                address(depositToken),
                vars.positionAsset,
                vars.positionAssetDecimals,
                _isProtocolFeeInPmx,
                _takeDepositFromWallet,
                vars.dex
            )
        );

        //closeRoutes
        vars.routes = new PrimexPricingLibrary.Route[](1);
        vars.routes[0] = PrimexPricingLibrary.Route({paths: new PrimexPricingLibrary.SwapPath[](1), shares: 1});
        vars.path = new address[](2);
        vars.path[0] = vars.positionAsset;
        vars.path[1] = address(depositToken);
        vars.routes[0].paths[0].encodedPath = PrimexPricingLibrary.encodePath(
            vars.path,
            pm.primexDNS().getDexAddress(vars.dex),
            _getAncillaryDexData(vars.dex),
            pm.primexDNS().dexAdapter(),
            false
        );

        //between 1 and balance of this contract
        uint256 increaseAmount = 1 + (_increaseAmountSeed % IERC20Mock(depositToken).balanceOf(address(this)));
        IERC20Mock(depositToken).approve(address(pm), increaseAmount);
        _increaseDeposit_should_not_revert(
            vars.positionId,
            increaseAmount,
            address(depositToken),
            true,
            vars.routes,
            0
        );
        revert();
    }

    function _increaseDeposit_should_not_revert(
        uint256 _positionId,
        uint256 _amount,
        address _asset,
        bool _takeDepositFromWallet,
        PrimexPricingLibrary.Route[] memory _routes,
        uint256 _amountOutMin
    ) internal {
        try pm.increaseDeposit(_positionId, _amount, _asset, _takeDepositFromWallet, _routes, _amountOutMin) {} catch {
            assert(false);
        }
    }

    function partiallyClosePosition_never_revert(
        uint40 _closeAmountSeed,
        uint40 _depositAmountSeed,
        uint40 _borrowedAmountSeed,
        bool _takeDepositFromWallet,
        bool _isProtocolFeeInPmx,
        bool _randomReceiver
    ) public {
        LocalVars memory vars;
        vars.depositAmount = MIN_DEPOSIT_AMOUNT + (_depositAmountSeed % (MAX_DEPOSIT_AMOUNT - MIN_DEPOSIT_AMOUNT));
        (vars.positionAsset, vars.positionAssetDecimals) = _getRandomPositionAsset(0);
        MIN_BORROWED_AMOUNT = 1 * 10 ** depositTokenDecimals;
        //calculate max borrowed amount considering the maxAssetLeverage
        MAX_BORROWED_AMOUNT = bucket.maxAssetLeverage(vars.positionAsset).wmul(vars.depositAmount) - vars.depositAmount;
        vars.borrowedAmount = MIN_BORROWED_AMOUNT + (_borrowedAmountSeed % (MAX_BORROWED_AMOUNT - MIN_BORROWED_AMOUNT));

        //uniswap
        vars.dex = _getRandomDex(0);
        vars.positionId = _openValidPosition(
            OpenPositionParams(
                vars.depositAmount,
                vars.borrowedAmount,
                address(depositToken),
                vars.positionAsset,
                vars.positionAssetDecimals,
                _isProtocolFeeInPmx,
                _takeDepositFromWallet,
                vars.dex
            )
        );
        vars.path[0] = vars.positionAsset;
        vars.path[1] = address(depositToken);
        vars.routes[0].paths[0].encodedPath = PrimexPricingLibrary.encodePath(
            vars.path,
            pm.primexDNS().getDexAddress(vars.dex),
            _getAncillaryDexData(vars.dex),
            pm.primexDNS().dexAdapter(),
            false
        );
        uint256 positionAmount = pm.getPosition(vars.positionId).positionAmount;
        // between 0 and positionAmount;
        uint256 closeAmount = (_closeAmountSeed % positionAmount);

        // to avoid trying to burn 0 debt tokens.
        if (vars.borrowedAmount == 0 || vars.borrowedAmount.wmul(closeAmount.wdiv(positionAmount)) > 0) {
            _setCorrectOraclePrice(
                SetCorrectOraclePriceParams(
                    closeAmount,
                    vars.dex,
                    vars.path,
                    vars.positionAssetDecimals,
                    depositTokenDecimals
                )
            );
            _partiallyClosePosition_should_not_revert(
                vars.positionId,
                closeAmount,
                _randomReceiver ? randomAddress : address(this),
                vars.routes,
                0
            );
        }
        revert();
    }

    function openPosition_and_closePosition_never_revert(
        uint40 _depositAmountSeed,
        uint40 _borrowedAmountSeed,
        uint8 _positionAssetSeed,
        uint8 _dexSeed,
        bool _takeDepositFromWallet,
        bool _isProtocolFeeInPmx,
        bool _randomReceiver
    ) public {
        LocalVars memory vars;
        vars.depositAmount = MIN_DEPOSIT_AMOUNT + (_depositAmountSeed % (MAX_DEPOSIT_AMOUNT - MIN_DEPOSIT_AMOUNT));
        (vars.positionAsset, vars.positionAssetDecimals) = _getRandomPositionAsset(_positionAssetSeed);

        //calculate max borrowed amount considering the maxAssetLeverage
        MAX_BORROWED_AMOUNT = bucket.maxAssetLeverage(vars.positionAsset).wmul(vars.depositAmount) - vars.depositAmount;
        vars.borrowedAmount = MIN_BORROWED_AMOUNT + (_borrowedAmountSeed % (MAX_BORROWED_AMOUNT - MIN_BORROWED_AMOUNT));
        _addLiquidityToBucket(vars.borrowedAmount);
        vars.dex = _getRandomDex(_dexSeed);
        PrimexPricingLibrary.Route[] memory routes = new PrimexPricingLibrary.Route[](1);
        PrimexPricingLibrary.Route memory route = PrimexPricingLibrary.Route({
            paths: new PrimexPricingLibrary.SwapPath[](1),
            shares: 1
        });
        address[] memory path = new address[](2);
        path[0] = address(depositToken);
        path[1] = vars.positionAsset;
        route.paths[0] = PrimexPricingLibrary.SwapPath({
            dexName: vars.dex,
            encodedPath: PrimexPricingLibrary.encodePath(
                path,
                pm.primexDNS().getDexAddress(vars.dex),
                _getAncillaryDexData(vars.dex),
                pm.primexDNS().dexAdapter(),
                false
            )
        });
        routes[0] = route;
        vars.closeAmount = _setCorrectOraclePrice(
            SetCorrectOraclePriceParams(
                vars.depositAmount + vars.borrowedAmount,
                vars.dex,
                path,
                depositTokenDecimals,
                vars.positionAssetDecimals
            )
        );
        PositionLibrary.OpenPositionMarginParams memory marginParams = PositionLibrary.OpenPositionMarginParams({
            bucket: vars.borrowedAmount == 0 ? new string(0) : bucket.name(),
            borrowedAmount: vars.borrowedAmount,
            depositInThirdAssetRoutes: new PrimexPricingLibrary.Route[](0)
        });
        LimitOrderLibrary.Condition[] memory cond = new LimitOrderLibrary.Condition[](0);
        PositionLibrary.OpenPositionParams memory params = PositionLibrary.OpenPositionParams({
            marginParams: marginParams,
            firstAssetRoutes: routes,
            depositAsset: address(depositToken),
            depositAmount: vars.depositAmount,
            isProtocolFeeInPmx: _isProtocolFeeInPmx,
            positionAsset: vars.positionAsset,
            amountOutMin: 0,
            deadline: block.timestamp + 100,
            takeDepositFromWallet: _takeDepositFromWallet,
            payFeeFromWallet: _takeDepositFromWallet,
            closeConditions: cond
        });
        vars.protocolFee = _beforeDeposit(
            _takeDepositFromWallet,
            _isProtocolFeeInPmx,
            vars.depositAmount,
            vars.borrowedAmount
        );
        _openPosition_should_not_revert(params, _takeDepositFromWallet && !_isProtocolFeeInPmx ? vars.protocolFee : 0);
        path[0] = vars.positionAsset;
        path[1] = address(depositToken);
        routes[0].paths[0].encodedPath = PrimexPricingLibrary.encodePath(
            path,
            pm.primexDNS().getDexAddress(vars.dex),
            _getAncillaryDexData(vars.dex),
            pm.primexDNS().dexAdapter(),
            false
        );
        _setCorrectOraclePrice(
            SetCorrectOraclePriceParams(
                vars.closeAmount,
                vars.dex,
                path,
                vars.positionAssetDecimals,
                depositTokenDecimals
            )
        );
        _closePosition_should_not_revert(0, _randomReceiver ? randomAddress : address(this), routes, 0);
        revert();
    }

    function health_never_revert(
        uint256 _borrowedAssetAmountOutSeed,
        uint256 _pairPriceDropSeed,
        uint256 _securityBufferSeed,
        uint256 _oracleTolerableLimitSeed,
        uint256 _positionDebtSeed,
        uint256 _feeBufferSeed
    ) internal pure {
        // _feeBufferSeed == 0 then divide by zero
        uint256 feeBuffer = WadRayMath.WAD + (_feeBufferSeed % (WadRayMath.WAD * 100 - WadRayMath.WAD));
        uint256 debt = 100 + ((_positionDebtSeed % type(uint56).max) - 1);
        uint256 _borrowedAssetAmountOut = 1 + (_borrowedAssetAmountOutSeed % (type(uint56).max - 1));
        try
            PositionLibrary.health(
                _borrowedAssetAmountOut,
                _pairPriceDropSeed % WadRayMath.WAD, // max WadRayMath.WAD - 1
                _securityBufferSeed % WadRayMath.WAD, // max WadRayMath.WAD - 1
                (_oracleTolerableLimitSeed % WadRayMath.WAD) + 1, // max WadRayMath.WAD
                debt,
                feeBuffer
            )
        returns (uint256 health) {
            assert(health > 0);
        } catch {
            assert(false);
        }
    }

    function _partiallyClosePosition_should_not_revert(
        uint256 _positionId,
        uint256 _amount,
        address _depositReceiver,
        PrimexPricingLibrary.Route[] memory _routes,
        uint256 _amountOutMin
    ) internal {
        try pm.partiallyClosePosition(_positionId, _amount, _depositReceiver, _routes, _amountOutMin) {
            assert(true);
        } catch {
            assert(false);
        }
    }

    function _addLiquidityToBucket(uint256 _amount) internal {
        if (_amount > 0) {
            depositToken.approve(address(bucket), _amount);
            bucket.deposit(address(this), _amount);
        }
    }

    function _getRandomDex(uint8 _seed) internal view returns (string memory) {
        return dexes[_seed % dexes.length];
    }

    function _getRandomPositionAsset(uint8 _seed) internal view returns (address, uint256) {
        return (address(tokensToBuy[_seed % tokensToBuy.length]), decimals[_seed % tokensToBuy.length]);
    }

    function _getAncillaryDexData(string memory _dex) internal pure returns (bytes32) {
        if (keccak256(bytes(_dex)) == keccak256("uniswapv3")) {
            return bytes32(uint256(3000));
        }
        return bytes32(0);
    }

    function _getAmountsOut(
        address _tokenA,
        address _tokenB,
        uint256 _amountA,
        string memory _dex
    ) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _tokenA;
        path[1] = _tokenB;
        return
            dexAdapter.getAmountsOut(
                IDexAdapter.GetAmountsParams(
                    PrimexPricingLibrary.encodePath(
                        path,
                        pm.primexDNS().getDexAddress(_dex),
                        _getAncillaryDexData(_dex),
                        pm.primexDNS().dexAdapter(),
                        false
                    ),
                    _amountA,
                    pm.primexDNS().getDexAddress(_dex)
                )
            )[1];
    }

    function _setCorrectOraclePrice(SetCorrectOraclePriceParams memory _params) internal returns (uint256) {
        if (_params.swapSize == 0) return 0;
        uint256 amountOutB = _getAmountsOut(_params.path[0], _params.path[1], _params.swapSize, _params.dex);
        amountOutB = amountOutB * 10 ** (18 - _params.bTokenDecimals);
        (address basePriceFeed, address quotePriceFeed) = priceOracle.getPriceFeedsPair(
            _params.path[0],
            _params.path[1]
        );
        (, int256 quotePrice, , , ) = AggregatorV3Interface(quotePriceFeed).latestRoundData();

        (, bool isForward) = priceOracle.getExchangeRate(_params.path[0], _params.path[1]);
        uint256 basePrice;
        quotePrice = quotePrice * 10 ** (18 - 8);
        if (isForward) {
            // (amountB * mulB) / (amountA * mulA) * quotePrice
            uint256 targetPrice = amountOutB.wdiv(_params.swapSize * 10 ** (18 - _params.aTokenDecimals));
            basePrice = targetPrice.wmul(uint256(quotePrice));
        } else {
            // (amountA * mulA) / (amountB * mulB) * quotePrice
            uint256 targetPrice = (_params.swapSize * 10 ** (18 - _params.aTokenDecimals)).wdiv(amountOutB);
            basePrice = targetPrice.wmul(uint256(quotePrice));
        }
        priceFeedUpdaterTestService.updatePriceFeed(
            PrimexAggregatorV3TestService(basePriceFeed),
            int256(basePrice / 10 ** (18 - 8))
        );
        return amountOutB / 10 ** (18 - _params.bTokenDecimals);
    }

    function _openValidPosition(OpenPositionParams memory _params) internal returns (uint256) {
        _addLiquidityToBucket(_params.borrowedAmount);
        PrimexPricingLibrary.Route[] memory routes = new PrimexPricingLibrary.Route[](1);
        routes[0] = PrimexPricingLibrary.Route({paths: new PrimexPricingLibrary.SwapPath[](1), shares: 1});

        address[] memory path = new address[](2);
        path[0] = _params.depositAsset;
        path[1] = _params.positionAsset;
        routes[0].paths[0] = PrimexPricingLibrary.SwapPath({
            dexName: _params.dex,
            encodedPath: PrimexPricingLibrary.encodePath(
                path,
                pm.primexDNS().getDexAddress(_params.dex),
                _getAncillaryDexData(_params.dex),
                pm.primexDNS().dexAdapter(),
                false
            )
        });
        PositionLibrary.OpenPositionMarginParams memory marginParams = PositionLibrary.OpenPositionMarginParams({
            bucket: _params.borrowedAmount == 0 ? new string(0) : bucket.name(),
            borrowedAmount: _params.borrowedAmount,
            depositInThirdAssetRoutes: new PrimexPricingLibrary.Route[](0)
        });
        LimitOrderLibrary.Condition[] memory conditions = new LimitOrderLibrary.Condition[](0);
        PositionLibrary.OpenPositionParams memory params = PositionLibrary.OpenPositionParams({
            marginParams: marginParams,
            firstAssetRoutes: routes,
            depositAsset: _params.depositAsset,
            depositAmount: _params.depositAmount,
            isProtocolFeeInPmx: _params.isProtocolFeeInPmx,
            positionAsset: _params.positionAsset,
            amountOutMin: 0,
            deadline: block.timestamp + 100,
            takeDepositFromWallet: _params.takeDepositFromWallet,
            payFeeFromWallet: _params.takeDepositFromWallet,
            closeConditions: conditions
        });
        uint256 protocolFee = _beforeDeposit(
            _params.takeDepositFromWallet,
            _params.isProtocolFeeInPmx,
            _params.depositAmount,
            _params.borrowedAmount
        );
        _setCorrectOraclePrice(
            SetCorrectOraclePriceParams(
                _params.depositAmount + _params.borrowedAmount,
                _params.dex,
                path,
                depositTokenDecimals,
                _params.positionAssetDecimals
            )
        );
        return
            _openPosition_should_not_revert(
                params,
                _params.takeDepositFromWallet && !_params.isProtocolFeeInPmx ? protocolFee : 0
            );
    }

    function _beforeDeposit(
        bool _takeDepositFromWallet,
        bool _isProtocolFeeInPmx,
        uint256 _depositAmount,
        uint256 _borrowedAmount
    ) internal returns (uint256 protocolFee) {
        protocolFee = PrimexPricingLibrary.getOracleAmountsOut(
            address(depositToken),
            _isProtocolFeeInPmx ? address(epmx) : NATIVE_CURRENCY,
            (_depositAmount + _borrowedAmount).wmul(_isProtocolFeeInPmx ? protocolRateInPmx : protocolRate),
            address(priceOracle)
        );
        if (_takeDepositFromWallet) {
            depositToken.approve(address(pm), _depositAmount);
            if (_isProtocolFeeInPmx) epmx.approve(address(pm), protocolFee);
        } else {
            depositToken.approve(address(traderBalanceVault), _depositAmount);
            traderBalanceVault.deposit(address(depositToken), _depositAmount);
            if (_isProtocolFeeInPmx) {
                epmx.approve(address(traderBalanceVault), protocolFee);
                traderBalanceVault.deposit(address(epmx), protocolFee);
            } else {
                traderBalanceVault.deposit{value: protocolFee}(address(0), 0);
            }
        }
    }

    function _openPosition_should_not_revert(
        PositionLibrary.OpenPositionParams memory _params,
        uint256 _value
    ) internal returns (uint256 positionId) {
        positionId = pm.positionsId();
        try pm.openPosition{value: _value}(_params) {} catch {
            assert(false);
        }
    }

    function _closePosition_should_not_revert(
        uint256 _id,
        address _depositReceiver,
        PrimexPricingLibrary.Route[] memory _routes,
        uint256 _amountOutMin
    ) internal {
        try pm.closePosition(_id, _depositReceiver, _routes, _amountOutMin) {
            assert(true);
        } catch {
            assert(false);
        }
    }

    function _openPosition_should_revert(PositionLibrary.OpenPositionParams memory _params, uint256 _value) internal {
        try pm.openPosition{value: _value}(_params) {
            assert(false);
        } catch {
            assert(true);
        }
    }
}
