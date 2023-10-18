// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;
import {SwapManager, ISwapManager} from "../SwapManager.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IPriceOracle} from "../PriceOracle/IPriceOracle.sol";
import {ITreasury} from "../Treasury/ITreasury.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IERC20Mock} from "../interfaces/IERC20Mock.sol";
import {NATIVE_CURRENCY} from "../Constants.sol";
import {IPrimexDNSStorage} from "../PrimexDNS/IPrimexDNSStorage.sol";

contract SwapManagerFuzz {
    using WadRayMath for uint256;

    SwapManager internal sm = SwapManager(0x24DF5F93B17Bab7C5a61a944D45901f73D0c072a);
    IPriceOracle internal priceOracle = IPriceOracle(0xaE52826fC2AB091C026Cf8c919b76b3A4996fd8B);
    ITreasury internal treasury = ITreasury(payable(0x6E1D5f7e162eE74F333E0c433196434A5Dedd2A7));
    ITraderBalanceVault internal traderBalanceVault =
        ITraderBalanceVault(payable(0x1660b74302A5d34b2db784CAF456BD39C2D9942c));
    IERC20Mock internal epmx = IERC20Mock(0xD1aE64401d65E9B0d1bF7E08Fbf75bb2F26eF70a);

    // "usdc", "weth", "wbtc", "link", "uni", "usdt"
    IERC20Mock[6] internal tokens = [
        IERC20Mock(0x871DD7C2B4b25E1Aa18728e9D5f2Af4C4e431f5c),
        IERC20Mock(0x1dC4c1cEFEF38a777b15aA20260a54E584b16C48),
        IERC20Mock(0x1D7022f5B17d2F8B695918FB48fa1089C9f85401),
        IERC20Mock(0x0B1ba0af832d7C05fD64161E0Db78E85978E8082),
        IERC20Mock(0x48BaCB9266a570d521063EF5dD96e61686DbE788),
        IERC20Mock(0x34D402F14D58E001D8EfBe6585051BF9706AA064)
    ];
    uint8[6] internal decimals = [6, 18, 8, 18, 18, 6];

    string[5] internal dexes = ["uniswap", "sushiswap", "uniswapv3", "quickswapv3", "meshswap"];

    uint256 internal swapRate = sm.primexDNS().feeRates(IPrimexDNSStorage.OrderType.SWAP_MARKET_ORDER, address(0));
    uint256 internal swapRateInPmx =
        sm.primexDNS().feeRates(IPrimexDNSStorage.OrderType.SWAP_MARKET_ORDER, address(epmx));

    struct Vars {
        address tokenA;
        address tokenB;
        uint8 tokenADecimals;
        uint8 tokenBDecimals;
        uint256 amountTokenA;
        uint256 minTokenAAmount;
        uint256 maxTokenAAmount;
        uint256 amountOut;
        string dex;
        PrimexPricingLibrary.Route[] routes;
        PrimexPricingLibrary.Route route;
        address[] path;
        ISwapManager.SwapParams params;
        address feeToken;
        uint256 swapFee;
        uint256 traderBalanceTokenABefore;
        uint256 traderBalanceTokenBBefore;
        uint256 traderBalancePmxBefore;
        uint256 traderBalanceETHBefore;
        uint256 traderBalanceOnTraderBalanceVaultFeeTokenBefore;
        uint256 traderBalanceOnTraderBalanceVaultTokenABefore;
        uint256 traderBalanceOnTraderBalanceVaultTokenBBefore;
        uint256 treasuryBalancePmxBefore;
        uint256 treasuryBalanceETHBefore;
        uint256 traderBalanceTokenAAfter;
        uint256 traderBalanceTokenBAfter;
        uint256 traderBalancePmxAfter;
        uint256 traderBalanceETHAfter;
        uint256 traderBalanceOnTraderBalanceVaultFeeTokenAfter;
        uint256 traderBalanceOnTraderBalanceVaultTokenAAfter;
        uint256 traderBalanceOnTraderBalanceVaultTokenBAfter;
        uint256 treasuryBalancePmxAfter;
        uint256 treasuryBalanceETHAfter;
    }

    constructor() payable {}

    // solhint-disable-next-line comprehensive-interface
    function testSwap(
        uint128 _tokenASeed,
        uint128 _tokenBSeed,
        uint256 _amountTokenASeed,
        uint8 _dexSeed,
        bool _isSwapFromWallet,
        bool _isSwapToWallet,
        bool _isSwapFeeInPmx
    ) public {
        // Pre-conditiion
        Vars memory vars;
        (vars.tokenA, vars.tokenADecimals) = _getRandomToken(_tokenASeed);
        (vars.tokenB, vars.tokenBDecimals) = _getRandomToken(_tokenBSeed);
        vars.minTokenAAmount = 1 * 10 ** vars.tokenADecimals;
        vars.maxTokenAAmount = 10000 * 10 ** vars.tokenADecimals;
        vars.amountTokenA = vars.minTokenAAmount + (_amountTokenASeed % (vars.maxTokenAAmount - vars.minTokenAAmount));
        vars.dex = _getRandomDex(_dexSeed);
        vars.routes = new PrimexPricingLibrary.Route[](1);
        vars.route = PrimexPricingLibrary.Route({paths: new PrimexPricingLibrary.SwapPath[](1), shares: 1});
        vars.path = new address[](2);
        vars.path[0] = vars.tokenA;
        vars.path[1] = vars.tokenB;
        vars.route.paths[0] = PrimexPricingLibrary.SwapPath({
            dexName: vars.dex,
            encodedPath: PrimexPricingLibrary.encodePath(
                vars.path,
                sm.primexDNS().getDexAddress(vars.dex),
                _getAncillaryDexData(vars.dex),
                sm.primexDNS().dexAdapter(),
                false
            )
        });
        vars.routes[0] = vars.route;
        vars.params = ISwapManager.SwapParams({
            tokenA: vars.tokenA,
            tokenB: vars.tokenB,
            amountTokenA: vars.amountTokenA,
            amountOutMin: 0,
            routes: vars.routes,
            receiver: address(this),
            deadline: block.timestamp + 100,
            isSwapFromWallet: _isSwapFromWallet,
            isSwapToWallet: _isSwapToWallet,
            isSwapFeeInPmx: _isSwapFeeInPmx,
            payFeeFromWallet: _isSwapFromWallet
        });

        (vars.feeToken, vars.swapFee) = _getSwapFee(vars.tokenA, vars.amountTokenA, _isSwapFeeInPmx);

        if (_isSwapFromWallet) {
            IERC20Mock(vars.tokenA).approve(address(sm), vars.amountTokenA);
            if (_isSwapFeeInPmx) {
                epmx.approve(address(sm), vars.swapFee);
            }
        } else {
            IERC20Mock(vars.tokenA).approve(address(traderBalanceVault), vars.amountTokenA);
            traderBalanceVault.deposit(vars.tokenA, vars.amountTokenA);
            if (_isSwapFeeInPmx) {
                epmx.approve(address(traderBalanceVault), vars.swapFee);
                traderBalanceVault.deposit(address(epmx), vars.swapFee);
            } else {
                traderBalanceVault.deposit{value: vars.swapFee}(address(0), 0);
            }
        }

        vars.traderBalanceTokenABefore = IERC20Mock(vars.tokenA).balanceOf(address(this));
        vars.traderBalanceTokenBBefore = IERC20Mock(vars.tokenB).balanceOf(address(this));
        vars.traderBalancePmxBefore = epmx.balanceOf(address(this));
        vars.traderBalanceETHBefore = address(this).balance;
        vars.treasuryBalancePmxBefore = epmx.balanceOf(address(treasury));
        vars.treasuryBalanceETHBefore = address(treasury).balance;
        (vars.traderBalanceOnTraderBalanceVaultFeeTokenBefore, ) = traderBalanceVault.balances(
            address(this),
            vars.feeToken
        );
        (vars.traderBalanceOnTraderBalanceVaultTokenABefore, ) = traderBalanceVault.balances(
            address(this),
            vars.tokenA
        );
        (vars.traderBalanceOnTraderBalanceVaultTokenBBefore, ) = traderBalanceVault.balances(
            address(this),
            vars.tokenB
        );

        // Action
        vars.amountOut = sm.swap(vars.params, 0, false);

        // Post-condition
        vars.traderBalanceTokenAAfter = IERC20Mock(vars.tokenA).balanceOf(address(this));
        vars.traderBalanceTokenBAfter = IERC20Mock(vars.tokenB).balanceOf(address(this));
        vars.traderBalancePmxAfter = epmx.balanceOf(address(this));
        vars.traderBalanceETHAfter = address(this).balance;
        vars.treasuryBalancePmxAfter = epmx.balanceOf(address(treasury));
        vars.treasuryBalanceETHAfter = address(treasury).balance;
        (vars.traderBalanceOnTraderBalanceVaultFeeTokenAfter, ) = traderBalanceVault.balances(
            address(this),
            vars.feeToken
        );
        (vars.traderBalanceOnTraderBalanceVaultTokenAAfter, ) = traderBalanceVault.balances(address(this), vars.tokenA);
        (vars.traderBalanceOnTraderBalanceVaultTokenBAfter, ) = traderBalanceVault.balances(address(this), vars.tokenB);

        if (_isSwapFromWallet) {
            if (_isSwapFeeInPmx) {
                assert(vars.traderBalancePmxBefore - vars.swapFee == vars.traderBalancePmxAfter);
                assert(vars.treasuryBalancePmxBefore + vars.swapFee == vars.treasuryBalancePmxAfter);
            } else {
                assert(vars.traderBalanceETHBefore - vars.swapFee == vars.traderBalanceETHAfter);
                assert(vars.treasuryBalanceETHBefore + vars.swapFee == vars.treasuryBalanceETHAfter);
            }

            if (_isSwapToWallet) {
                assert(vars.traderBalanceTokenABefore - vars.amountTokenA == vars.traderBalanceTokenAAfter);
                assert(vars.traderBalanceTokenBBefore + vars.amountOut == vars.traderBalanceTokenBAfter);
            } else {
                assert(vars.traderBalanceTokenABefore - vars.amountTokenA == vars.traderBalanceTokenAAfter);
                assert(
                    vars.traderBalanceOnTraderBalanceVaultTokenBBefore + vars.amountOut ==
                        vars.traderBalanceOnTraderBalanceVaultTokenBAfter
                );
            }
        } else {
            assert(
                vars.traderBalanceOnTraderBalanceVaultFeeTokenBefore - vars.swapFee ==
                    vars.traderBalanceOnTraderBalanceVaultFeeTokenAfter
            );
            if (_isSwapFeeInPmx) {
                assert(vars.treasuryBalancePmxBefore + vars.swapFee == vars.treasuryBalancePmxAfter);
            } else {
                assert(vars.treasuryBalanceETHBefore + vars.swapFee == vars.treasuryBalanceETHAfter);
            }

            if (_isSwapToWallet) {
                assert(
                    vars.traderBalanceOnTraderBalanceVaultTokenABefore - vars.amountTokenA ==
                        vars.traderBalanceOnTraderBalanceVaultTokenAAfter
                );
                assert(vars.traderBalanceTokenBBefore + vars.amountOut == vars.traderBalanceTokenBAfter);
            } else {
                assert(
                    vars.traderBalanceOnTraderBalanceVaultTokenABefore - vars.amountTokenA ==
                        vars.traderBalanceOnTraderBalanceVaultTokenAAfter
                );
                assert(
                    vars.traderBalanceOnTraderBalanceVaultTokenBBefore + vars.amountOut ==
                        vars.traderBalanceOnTraderBalanceVaultTokenBAfter
                );
            }
        }
    }

    function _getRandomDex(uint8 _seed) internal view returns (string memory) {
        return dexes[_seed % dexes.length];
    }

    function _getRandomToken(uint256 _seed) internal view returns (address, uint8) {
        _seed = uint8(_seed % tokens.length);
        return (address(tokens[_seed]), decimals[_seed]);
    }

    function _getAncillaryDexData(string memory _dex) internal pure returns (bytes32) {
        if (keccak256(bytes(_dex)) == keccak256("uniswapv3")) {
            return bytes32(uint256(3000));
        }
        return bytes32(0);
    }

    function _getSwapFee(
        address tokenA,
        uint256 amountTokenA,
        bool _isSwapFeeInPmx
    ) internal view returns (address feeToken, uint256 swapFee) {
        feeToken = _isSwapFeeInPmx ? address(epmx) : NATIVE_CURRENCY;
        swapFee = PrimexPricingLibrary.getOracleAmountsOut(
            address(tokenA),
            feeToken,
            (amountTokenA).wmul(WadRayMath.WAD).wmul(_isSwapFeeInPmx ? swapRateInPmx : swapRate),
            address(priceOracle)
        );
        assert(swapFee > 0);
    }
}
