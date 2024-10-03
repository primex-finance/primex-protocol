// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {ISwapRouter as ISwapRouterAlgebraV3} from "@cryptoalgebra/solidity-interfaces/contracts/periphery/ISwapRouter.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IQuoter} from "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
import {IQuoter as IQuoterAlgebraV3} from "@cryptoalgebra/solidity-interfaces/contracts/periphery/IQuoter.sol";
import {WadRayMath} from "./libraries/utils/WadRayMath.sol";
import {V3Path} from "./libraries/utils/V3Path.sol";
import {TokenApproveLibrary} from "./libraries/TokenApproveLibrary.sol";
import {PrimexPricingLibrary} from "./libraries/PrimexPricingLibrary.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IPrimexDNSV3} from "./PrimexDNS/IPrimexDNS.sol";
import {IAugustusSwapper} from "./interfaces/IAugustusSwapper.sol";

import "./libraries/Errors.sol";

import {MEDIUM_TIMELOCK_ADMIN, BIG_TIMELOCK_ADMIN, VAULT_ACCESS_ROLE, NATIVE_CURRENCY, NATIVE_CURRENCY_CURVE} from "./Constants.sol";
import {IBalancer} from "./interfaces/IBalancer.sol";
import {IAsset} from "./interfaces/IAsset.sol";
import {IDexAdapter} from "./interfaces/IDexAdapter.sol";
import {ICurveRouter} from "./interfaces/routers/ICurveRouter.sol";
import {IWNative} from "./interfaces/IWNative.sol";

contract DexAdapter is IDexAdapter, IERC165, Initializable {
    using WadRayMath for uint256;
    using V3Path for bytes;

    /**
     * @inheritdoc IDexAdapter
     */
    mapping(address => DexType) public override dexType;

    /**
     * @inheritdoc IDexAdapter
     */
    mapping(address => address) public override quoters;

    /**
     * @inheritdoc IDexAdapter
     */
    address public immutable override registry;

    IPrimexDNSV3 public primexDNS;

    /**
     * @dev e.g WETH or WMATIC
     */
    // solhint-disable-next-line var-name-mixedcase
    IWNative public immutable WNative;

    receive() external payable override {}

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    // solhint-disable-next-line var-name-mixedcase
    constructor(address _registry, address _WNative) {
        _require(
            IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
        WNative = IWNative(_WNative);
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function initialize(address _primexDNS) external override initializer onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        primexDNS = IPrimexDNSV3(_primexDNS);
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function setQuoter(address _dexRouter, address _quoter) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(uint256(dexType[_dexRouter]) > 0, Errors.DEX_ROUTER_NOT_SUPPORTED.selector);
        _require(_quoter != address(0), Errors.QUOTER_NOT_SUPPORTED.selector);
        quoters[_dexRouter] = _quoter;
        emit QuoterChanged(_dexRouter, _quoter);
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function setDexType(address _dexRouter, uint256 _dexType) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(_dexRouter != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        dexType[_dexRouter] = DexType(_dexType);
        emit DexTypeChanged(_dexRouter, _dexType);
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function performMegaRoutesSwap(
        PrimexPricingLibrary.MegaSwapParams calldata _params
    ) external payable override returns (uint256) {
        _require(_params.deadline >= block.timestamp, Errors.SWAP_DEADLINE_PASSED.selector);
        MegaSwapVars memory vars;

        for (uint256 i; i < _params.megaRoutes.length; i++) {
            vars.sumOfShares += _params.megaRoutes[i].shares;
        }
        _require(vars.sumOfShares > 0, Errors.SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO.selector);

        vars.remainder = _params.amountTokenA;

        for (uint256 i; i < _params.megaRoutes.length - 1; i++) {
            vars.amountOnMegaRoute = (_params.amountTokenA * _params.megaRoutes[i].shares) / vars.sumOfShares;
            vars.remainder -= vars.amountOnMegaRoute;
            vars.totalAmount += performRoutesSwap(
                _params.tokenA,
                vars.amountOnMegaRoute,
                _params.receiver,
                _params.megaRoutes[i].routes
            );
        }
        //perform the last route with the remainder
        vars.totalAmount += performRoutesSwap(
            _params.tokenA,
            vars.remainder,
            _params.receiver,
            _params.megaRoutes[_params.megaRoutes.length - 1].routes
        );
        return vars.totalAmount;
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function swapExactTokensForTokens(SwapParams memory _params) external payable override returns (uint256[3] memory) {
        _require(_params.to != address(0) && _params.dexRouter != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        _require(_params.amountIn != 0, Errors.ZERO_AMOUNT_IN.selector);
        return _swapExactTokensForTokens(_params);
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function getAmountOutByMegaRoutes(AmountParams calldata _params) external override returns (uint256) {
        _require(_params.tokenA != _params.tokenB, Errors.IDENTICAL_ASSETS.selector);

        MegaSwapVars memory vars;

        for (uint256 i; i < _params.megaRoutes.length; i++) {
            vars.sumOfShares += _params.megaRoutes[i].shares;
        }
        _require(vars.sumOfShares > 0, Errors.SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO.selector);
        vars.remainder = _params.amount;

        for (uint256 i; i < _params.megaRoutes.length - 1; i++) {
            vars.amountOnMegaRoute = (_params.amount * _params.megaRoutes[i].shares) / vars.sumOfShares;
            vars.remainder -= vars.amountOnMegaRoute;
            vars.totalAmount += getAmountsOutByRoutes(vars.amountOnMegaRoute, _params.megaRoutes[i].routes);
        }
        // getting amountOut for the last route
        vars.totalAmount += getAmountsOutByRoutes(
            vars.remainder,
            _params.megaRoutes[_params.megaRoutes.length - 1].routes
        );

        return vars.totalAmount;
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function getAmountInByMegaRoutes(AmountParams calldata _params) external override returns (uint256) {
        _require(_params.tokenA != _params.tokenB, Errors.IDENTICAL_ASSETS.selector);

        MegaSwapVars memory vars;

        for (uint256 i; i < _params.megaRoutes.length; i++) {
            vars.sumOfShares += _params.megaRoutes[i].shares;
        }
        _require(vars.sumOfShares > 0, Errors.SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO.selector);
        //amount is amountOut
        vars.remainder = _params.amount;

        for (uint256 i; i < _params.megaRoutes.length - 1; i++) {
            vars.amountOnMegaRoute = (_params.amount * _params.megaRoutes[i].shares) / vars.sumOfShares;
            vars.remainder -= vars.amountOnMegaRoute;
            vars.totalAmount += getAmountsInByRoutes(vars.amountOnMegaRoute, _params.megaRoutes[i].routes);
        }
        //getting amountIn for the last route
        vars.totalAmount += getAmountsInByRoutes(
            vars.remainder,
            _params.megaRoutes[_params.megaRoutes.length - 1].routes
        );

        return vars.totalAmount;
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function getGas(address dexRouter) external view override returns (uint256) {
        _require(dexRouter != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        DexType type_ = dexType[dexRouter];
        // These values are average taken from the gas tracker in etherscan
        // The actual values depend on many variables especially the more complex dex such as uniswap v3
        if (type_ == DexType.UniswapV2) {
            return 152809;
        } else if (type_ == DexType.UniswapV3 || type_ == DexType.AlgebraV3) {
            return 184523;
        } else if (type_ == DexType.Curve) {
            return 183758;
        } else if (type_ == DexType.Balancer) {
            return 196625;
        } else if (type_ == DexType.Meshswap) {
            return 271000;
        } else {
            _revert(Errors.UNKNOWN_DEX_TYPE.selector);
        }
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function performRoutesSwap(
        address tokenIn,
        uint256 amountIn,
        address receiver,
        PrimexPricingLibrary.Route[] calldata routes
    ) public payable override returns (uint256) {
        //amountInOnRoute will be either amountIn or amountOut of the previous route
        uint256 amountInOnRoute = amountIn;
        for (uint256 i; i < routes.length; i++) {
            //tokenInOnRoute will be either tokenIn or tokenOutOnRoute of the previous route
            address tokenInOnRoute = i > 0 ? routes[i - 1].to : tokenIn;
            address tokenOutOnRoute = routes[i].to;
            amountInOnRoute = performPathsSwap(
                tokenInOnRoute,
                tokenOutOnRoute,
                amountInOnRoute,
                i == routes.length - 1 ? receiver : address(this),
                routes[i].paths
            );
        }
        // at the last iteration amountInOnRoute will be amountOut of the last route
        return amountInOnRoute;
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function performPathsSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address receiver,
        PrimexPricingLibrary.Path[] calldata paths
    ) public payable override returns (uint256) {
        uint256 sumOfShares;
        uint256 totalAmount;

        for (uint256 i; i < paths.length; i++) {
            sumOfShares += paths[i].shares;
        }

        _require(sumOfShares > 0, Errors.SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO.selector);
        uint256 remainder = amountIn;
        SwapParams memory swapParams;
        swapParams.deadline = block.timestamp;
        swapParams.tokenIn = tokenIn;
        swapParams.tokenOut = tokenOut;
        swapParams.to = receiver;
        for (uint256 i; i < paths.length - 1; i++) {
            swapParams.amountIn = (amountIn * paths[i].shares) / sumOfShares;
            remainder -= swapParams.amountIn;
            swapParams.encodedPath = paths[i].payload;
            swapParams.dexRouter = primexDNS.getDexAddress(paths[i].dexName);
            totalAmount += _swapExactTokensForTokens(swapParams)[1];
        }
        // swap for the last path
        swapParams.amountIn = remainder;
        swapParams.encodedPath = paths[paths.length - 1].payload;
        swapParams.dexRouter = primexDNS.getDexAddress(paths[paths.length - 1].dexName);
        totalAmount += _swapExactTokensForTokens(swapParams)[1];
        return totalAmount;
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function getAmountsOutByRoutes(
        uint256 amountIn,
        PrimexPricingLibrary.Route[] calldata routes
    ) public override returns (uint256) {
        //amountInOnRoute will be either amountIn or amountOut of the previous route
        uint256 amountInOnRoute = amountIn;
        for (uint256 i; i < routes.length; i++) {
            amountInOnRoute = getAmountsOutByPaths(amountInOnRoute, routes[i].paths);
        }
        // at the last iteration amountInOnRoute will be amountOut of the last route
        return amountInOnRoute;
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function getAmountsOutByPaths(
        uint256 amountIn,
        PrimexPricingLibrary.Path[] calldata paths
    ) public override returns (uint256) {
        uint256 sumOfShares;
        uint256 totalAmount;

        for (uint256 i; i < paths.length; i++) {
            sumOfShares += paths[i].shares;
        }

        _require(sumOfShares > 0, Errors.SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO.selector);
        uint256 remainder = amountIn;
        GetAmountsParams memory getAmountsParams;
        for (uint256 i; i < paths.length - 1; i++) {
            getAmountsParams.amount = (amountIn * paths[i].shares) / sumOfShares;
            remainder -= getAmountsParams.amount;
            getAmountsParams.encodedPath = paths[i].payload;
            getAmountsParams.dexRouter = primexDNS.getDexAddress(paths[i].dexName);
            totalAmount += getAmountsOut(getAmountsParams)[1];
        }
        //getting amountOut for the last path
        getAmountsParams.amount = remainder;
        getAmountsParams.encodedPath = paths[paths.length - 1].payload;
        getAmountsParams.dexRouter = primexDNS.getDexAddress(paths[paths.length - 1].dexName);
        totalAmount += getAmountsOut(getAmountsParams)[1];
        return totalAmount;
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function getAmountsOut(GetAmountsParams memory _params) public override returns (uint256[3] memory) {
        _checkAmountsParams(_params);
        DexType type_ = dexType[_params.dexRouter];

        if (type_ == DexType.UniswapV2 || type_ == DexType.Meshswap) {
            return _getAmountsWithUniswapV2(_params);
        } else if (type_ == DexType.UniswapV3) {
            return _getAmountsWithUniswapV3(_params);
        } else if (type_ == DexType.Curve) {
            return _getAmountsWithCurve(_params);
        } else if (type_ == DexType.Balancer) {
            return _getAmountsWithBalancer(_params);
        } else if (type_ == DexType.AlgebraV3) {
            return _getAmountsWithAlgebraV3(_params);
        } else {
            _revert(Errors.UNKNOWN_DEX_TYPE.selector);
        }
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function getAmountsInByRoutes(
        uint256 amountOut,
        PrimexPricingLibrary.Route[] calldata routes
    ) public override returns (uint256) {
        //amountOutOnRoute will be either amountOut or amountIn of the previous route (in reverse order)
        uint256 amountOutOnRoute = amountOut;

        for (uint256 i = routes.length; i > 0; i--) {
            // i - 1 == current index
            amountOutOnRoute = getAmountsInByPaths(amountOutOnRoute, routes[i - 1].paths);
        }
        // at the last iteration amountOutOnRoute will be amountIn of the first route
        return amountOutOnRoute;
    }

    /**
     * @inheritdoc IDexAdapter
     */

    function getAmountsInByPaths(
        uint256 amountOut,
        PrimexPricingLibrary.Path[] calldata paths
    ) public override returns (uint256) {
        uint256 sumOfShares;
        uint256 totalAmountIn;

        for (uint256 i; i < paths.length; i++) {
            sumOfShares += paths[i].shares;
        }
        _require(sumOfShares > 0, Errors.SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO.selector);
        uint256 remainder = amountOut;
        GetAmountsParams memory getAmountsParams;
        for (uint256 i; i < paths.length - 1; i++) {
            getAmountsParams.amount = (amountOut * paths[i].shares) / sumOfShares;
            remainder -= getAmountsParams.amount;
            getAmountsParams.encodedPath = paths[i].payload;
            getAmountsParams.dexRouter = primexDNS.getDexAddress(paths[i].dexName);
            totalAmountIn += getAmountsIn(getAmountsParams)[0];
        }
        //getting amountIn for the last path
        getAmountsParams.amount = remainder;
        getAmountsParams.encodedPath = paths[paths.length - 1].payload;
        getAmountsParams.dexRouter = primexDNS.getDexAddress(paths[paths.length - 1].dexName);
        totalAmountIn += getAmountsIn(getAmountsParams)[0];
        return totalAmountIn;
    }

    /**
     * @inheritdoc IDexAdapter
     */
    function getAmountsIn(GetAmountsParams memory _params) public override returns (uint256[3] memory) {
        _checkAmountsParams(_params);
        DexType type_ = dexType[_params.dexRouter];

        if (type_ == DexType.UniswapV2 || type_ == DexType.Meshswap) {
            return _getAmountsInWithUniswapV2(_params);
        } else if (type_ == DexType.UniswapV3) {
            return _getAmountsInWithUniswapV3(_params);
        } else if (type_ == DexType.Curve) {
            return _getAmountsInWithCurve(_params);
        } else if (type_ == DexType.Balancer) {
            return _getAmountsInWithBalancer(_params);
        } else if (type_ == DexType.AlgebraV3) {
            return _getAmountsInWithAlgebraV3(_params);
        } else {
            _revert(Errors.UNKNOWN_DEX_TYPE.selector);
        }
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IERC165).interfaceId || _interfaceId == type(IDexAdapter).interfaceId;
    }

    function _swapExactTokensForTokens(SwapParams memory _params) internal returns (uint256[3] memory) {
        DexType type_ = dexType[_params.dexRouter];

        if (type_ == DexType.UniswapV2 || type_ == DexType.Meshswap) {
            return _swapWithUniswapV2(_params);
        } else if (type_ == DexType.UniswapV3) {
            return _swapWithUniswapV3(_params);
        } else if (type_ == DexType.Curve) {
            return _swapWithCurve(_params);
        } else if (type_ == DexType.Balancer) {
            return _swapWithBalancer(_params);
        } else if (type_ == DexType.AlgebraV3) {
            return _swapWithAlgebraV3(_params);
        } else if (type_ == DexType.Paraswap) {
            return _swapWithParaswap(_params);
        } else {
            _revert(Errors.UNKNOWN_DEX_TYPE.selector);
        }
    }

    function _getAmountsWithBalancer(GetAmountsParams memory _params) internal returns (uint256[3] memory) {
        (address[] memory path, bytes32[] memory pools, ) = abi.decode(
            _params.encodedPath,
            (address[], bytes32[], int256[])
        );
        (IAsset[] memory assets, IBalancer.BatchSwapStep[] memory steps) = _getBalancerSwapSteps(
            path,
            pools,
            _params.amount
        );

        IBalancer.FundManagement memory fundManagement = IBalancer.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        int256[] memory deltas;
        deltas = IBalancer(_params.dexRouter).queryBatchSwap(
            IBalancer.SwapKind.GIVEN_IN,
            steps,
            assets,
            fundManagement
        );
        /// @notice - queryBatchSwap will return a delta for each token in the assets array and last asset should be tokenOut
        _require(deltas[deltas.length - 1] <= 0, Errors.DELTA_OF_TOKEN_OUT_HAS_POSITIVE_VALUE.selector);
        uint256 amountOut = uint256(deltas[deltas.length - 1] * -1);
        return [_params.amount, amountOut, 0];
    }

    function _getAmountsInWithBalancer(GetAmountsParams memory _params) internal returns (uint256[3] memory) {
        (address[] memory path, bytes32[] memory pools, ) = abi.decode(
            _params.encodedPath,
            (address[], bytes32[], int256[])
        );
        IAsset[] memory assets = new IAsset[](path.length);
        IBalancer.BatchSwapStep[] memory steps = new IBalancer.BatchSwapStep[](pools.length);

        IBalancer.FundManagement memory fundManagement = IBalancer.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });
        for (uint256 i; i < path.length - 1; i++) {
            assets[i] = IAsset(path[i]);
            steps[path.length - 2 - i] = IBalancer.BatchSwapStep({
                poolId: pools[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: 0,
                userData: "0x"
            });
        }
        steps[0].amount = _params.amount;
        assets[path.length - 1] = IAsset(path[path.length - 1]);

        int256[] memory deltas;
        deltas = IBalancer(_params.dexRouter).queryBatchSwap(
            IBalancer.SwapKind.GIVEN_OUT,
            steps,
            assets,
            fundManagement
        );
        _require(deltas[0] >= 0, Errors.DELTA_OF_TOKEN_IN_HAS_NEGATIVE_VALUE.selector);
        return [uint256(deltas[0]), _params.amount, 0];
    }

    function _getAmountsWithUniswapV3(GetAmountsParams memory _params) internal returns (uint256[3] memory) {
        address quoter = quoters[_params.dexRouter];
        _require(address(quoter) != address(0), Errors.QUOTER_IS_NOT_PROVIDED.selector);
        uint256 amountOut = IQuoter(quoter).quoteExactInput(_params.encodedPath, _params.amount);
        return [_params.amount, amountOut, 0];
    }

    function _getAmountsInWithUniswapV3(GetAmountsParams memory _params) internal returns (uint256[3] memory) {
        address quoter = quoters[_params.dexRouter];
        _require(address(quoter) != address(0), Errors.QUOTER_IS_NOT_PROVIDED.selector);
        uint256 amountIn = IQuoter(quoter).quoteExactOutput(_params.encodedPath, _params.amount);
        return [amountIn, _params.amount, 0];
    }

    function _getAmountsWithAlgebraV3(GetAmountsParams memory _params) internal returns (uint256[3] memory) {
        address quoter = quoters[_params.dexRouter];
        _require(address(quoter) != address(0), Errors.QUOTER_IS_NOT_PROVIDED.selector);
        (uint256 amountOut, ) = IQuoterAlgebraV3(quoter).quoteExactInput(_params.encodedPath, _params.amount);
        return [_params.amount, amountOut, 0];
    }

    function _getAmountsInWithAlgebraV3(GetAmountsParams memory _params) internal returns (uint256[3] memory) {
        address quoter = quoters[_params.dexRouter];
        _require(address(quoter) != address(0), Errors.QUOTER_IS_NOT_PROVIDED.selector);
        (uint256 amountIn, ) = IQuoterAlgebraV3(quoter).quoteExactOutput(_params.encodedPath, _params.amount);
        return [amountIn, _params.amount, 0];
    }

    function _getAmountsWithCurve(GetAmountsParams memory _params) internal view returns (uint256[3] memory) {
        (address[] memory path, address[] memory pools) = abi.decode(_params.encodedPath, (address[], address[]));
        uint256 amountOut = _getExchangeAmountCurve(_params.amount, _params.dexRouter, path, pools);

        return [_params.amount, amountOut, 0];
    }

    function _getExchangeAmountCurve(
        uint256 amount,
        address dexRouter,
        address[] memory path,
        address[] memory pools
    ) internal view returns (uint256) {
        uint256 amountOut = amount;

        for (uint256 i; i < path.length - 1; i++) {
            amountOut = ICurveRouter(dexRouter).get_exchange_amount(pools[i], path[i], path[i + 1], amountOut);
        }
        return amountOut;
    }

    function _getAmountsInWithCurve(GetAmountsParams memory _params) internal view returns (uint256[3] memory) {
        (address[] memory path, address[] memory pools) = abi.decode(_params.encodedPath, (address[], address[]));
        uint256 inverseAmount = _getExchangeAmountCurve(
            _params.amount,
            _params.dexRouter,
            _reverseArray(path),
            _reverseArray(pools)
        );
        //expanding the search to +50% and -50% from the inverseAmount
        // mul by 0.5 WAD
        uint256 minValue = inverseAmount.wmul(5e17);
        // mul by 1.5 WAD
        uint256 maxValue = inverseAmount.wmul(15e17);
        uint256 amountIn;
        for (uint256 i; i <= 100; i++) {
            // first iteration checks the inverseAmount: (0.5 + 1.5) / 2
            uint256 middle = (minValue + maxValue) / 2;
            if (middle == amountIn) break;
            amountIn = middle;
            uint256 amountOut = _getExchangeAmountCurve(amountIn, _params.dexRouter, path, pools);
            if (amountOut == _params.amount) break;
            else if (amountOut < _params.amount) minValue = amountIn;
            else maxValue = amountIn;
        }
        return [amountIn, _params.amount, 0];
    }

    function _getAmountsWithUniswapV2(GetAmountsParams memory _params) internal view returns (uint256[3] memory) {
        address[] memory path = abi.decode(_params.encodedPath, (address[]));

        uint256[] memory amounts = IUniswapV2Router02(_params.dexRouter).getAmountsOut(_params.amount, path);

        return [_params.amount, amounts[amounts.length - 1], 0];
    }

    function _getAmountsInWithUniswapV2(GetAmountsParams memory _params) internal view returns (uint256[3] memory) {
        address[] memory path = abi.decode(_params.encodedPath, (address[]));

        uint256[] memory amounts = IUniswapV2Router02(_params.dexRouter).getAmountsIn(_params.amount, path);

        return [amounts[0], _params.amount, 0];
    }

    function _reverseArray(address[] memory source) internal pure returns (address[] memory) {
        uint256 length = source.length;
        address[] memory result = new address[](length);
        for (uint256 i; i < length; i++) {
            result[length - 1 - i] = source[i];
        }
        return result;
    }

    function _checkAmountsParams(GetAmountsParams memory _params) internal pure {
        _require(_params.dexRouter != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        _require(_params.amount != 0, Errors.ZERO_AMOUNT.selector);
    }

    function _getBalancerSwapSteps(
        address[] memory path,
        bytes32[] memory pools,
        uint256 amount
    ) internal pure returns (IAsset[] memory assets, IBalancer.BatchSwapStep[] memory steps) {
        assets = new IAsset[](path.length);
        steps = new IBalancer.BatchSwapStep[](pools.length);

        for (uint256 i; i < path.length - 1; i++) {
            assets[i] = IAsset(path[i]);
            steps[i] = IBalancer.BatchSwapStep({
                poolId: pools[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: 0,
                userData: "0x"
            });
        }
        steps[0].amount = amount;
        assets[path.length - 1] = IAsset(path[path.length - 1]);
    }

    function _swapWithUniswapV2(SwapParams memory _params) private returns (uint256[3] memory) {
        if (_params.tokenIn == NATIVE_CURRENCY) {
            WNative.deposit{value: _params.amountIn}();
        }

        address[] memory path = abi.decode(_params.encodedPath, (address[]));
        TokenApproveLibrary.doApprove(path[0], _params.dexRouter, _params.amountIn);
        uint256[] memory amounts;

        amounts = IUniswapV2Router02(_params.dexRouter).swapExactTokensForTokens(
            _params.amountIn,
            _params.amountOutMin,
            path,
            _params.to,
            _params.deadline
        );
        if (_params.tokenOut == NATIVE_CURRENCY) {
            WNative.withdraw(WNative.balanceOf(address(this)));
        }
        return [_params.amountIn, amounts[amounts.length - 1], 0];
    }

    function _swapWithUniswapV3(SwapParams memory _params) private returns (uint256[3] memory) {
        if (_params.tokenIn == NATIVE_CURRENCY) {
            WNative.deposit{value: _params.amountIn}();
        }

        address tokenIn = _params.encodedPath.decodeFirstToken();
        TokenApproveLibrary.doApprove(tokenIn, _params.dexRouter, _params.amountIn);

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: _params.encodedPath,
            recipient: _params.to,
            deadline: _params.deadline,
            amountIn: _params.amountIn,
            amountOutMinimum: _params.amountOutMin
        });
        uint256 amountOut;
        // slither-disable-next-line unused-return
        try ISwapRouter(_params.dexRouter).exactInput(params) returns (uint256 _amountOut) {
            // slither-disable-next-line variable-scope
            amountOut = _amountOut;
            if (_params.tokenOut == NATIVE_CURRENCY) {
                WNative.withdraw(WNative.balanceOf(address(this)));
            }
        } catch Error(string memory err) {
            // slither-disable-next-line variable-scope
            revert(err);
        } catch (bytes memory) {
            _revert(Errors.REVERTED_WITHOUT_A_STRING_TRY_TO_CHECK_THE_ANCILLARY_DATA.selector);
        }

        return [_params.amountIn, amountOut, 0];
    }

    function _swapWithAlgebraV3(SwapParams memory _params) private returns (uint256[3] memory) {
        if (_params.tokenIn == NATIVE_CURRENCY) {
            WNative.deposit{value: _params.amountIn}();
        }

        address tokenIn = _params.encodedPath.decodeFirstToken();
        TokenApproveLibrary.doApprove(tokenIn, _params.dexRouter, _params.amountIn);

        ISwapRouterAlgebraV3.ExactInputParams memory params = ISwapRouterAlgebraV3.ExactInputParams({
            path: _params.encodedPath,
            recipient: _params.to,
            deadline: _params.deadline,
            amountIn: _params.amountIn,
            amountOutMinimum: _params.amountOutMin
        });
        uint256 amountOut = ISwapRouterAlgebraV3(_params.dexRouter).exactInput(params);
        if (_params.tokenOut == NATIVE_CURRENCY) {
            WNative.withdraw(WNative.balanceOf(address(this)));
        }
        return [_params.amountIn, amountOut, 0];
    }

    function _swapWithParaswap(SwapParams memory _params) private returns (uint256[3] memory) {
        uint256 balance = IERC20(_params.tokenOut).balanceOf(_params.to);

        if (_params.tokenIn != NATIVE_CURRENCY) {
            TokenApproveLibrary.doApprove(
                _params.tokenIn,
                IAugustusSwapper(_params.dexRouter).getTokenTransferProxy(),
                _params.amountIn
            );
        }
        // we just pass all payload data to the target router
        Address.functionCallWithValue(
            _params.dexRouter,
            _params.encodedPath,
            _params.tokenIn == NATIVE_CURRENCY ? _params.amountIn : 0
        );

        balance = IERC20(_params.tokenOut).balanceOf(_params.to) - balance;
        _require(balance >= _params.amountOutMin, Errors.SLIPPAGE_TOLERANCE_EXCEEDED.selector);

        return [_params.amountIn, balance, 0];
    }

    function _swapWithCurve(SwapParams memory _params) private returns (uint256[3] memory) {
        // Curve does not check the deadline hence this check is necessary before the swap.
        _require(_params.deadline >= block.timestamp, Errors.SWAP_DEADLINE_PASSED.selector);
        (address[] memory path, address[] memory pools) = abi.decode(_params.encodedPath, (address[], address[]));
        uint256 amountOut = _params.amountIn;

        // we don't wrap and unwrap eth since the curve can handle the native currency
        for (uint256 i; i < path.length - 1; i++) {
            //'cause in the curve the native currency is denoted as 0xEeE...
            if (path[i] == NATIVE_CURRENCY_CURVE) {
                amountOut = ICurveRouter(_params.dexRouter).exchange{value: amountOut}(
                    pools[i],
                    path[i],
                    path[i + 1],
                    amountOut,
                    i == path.length - 2 ? _params.amountOutMin : 0,
                    i == path.length - 2 ? _params.to : address(this)
                );
            } else {
                TokenApproveLibrary.doApprove(path[i], _params.dexRouter, amountOut);
                amountOut = ICurveRouter(_params.dexRouter).exchange(
                    pools[i],
                    path[i],
                    path[i + 1],
                    amountOut,
                    i == path.length - 2 ? _params.amountOutMin : 0,
                    i == path.length - 2 ? _params.to : address(this)
                );
            }
        }

        return [_params.amountIn, amountOut, 0];
    }

    function _swapWithBalancer(SwapParams memory _params) private returns (uint256[3] memory) {
        (address[] memory path, bytes32[] memory pools, int256[] memory limits) = abi.decode(
            _params.encodedPath,
            (address[], bytes32[], int256[])
        );
        _require(path.length >= 2, Errors.INCORRECT_PATH.selector);

        if (_params.tokenIn == NATIVE_CURRENCY) {
            WNative.deposit{value: _params.amountIn}();
        }

        TokenApproveLibrary.doApprove(path[0], _params.dexRouter, _params.amountIn);

        IBalancer.FundManagement memory fundManagement = IBalancer.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(_params.to),
            toInternalBalance: false
        });

        if (path.length > 2) {
            (IAsset[] memory assets, IBalancer.BatchSwapStep[] memory steps) = _getBalancerSwapSteps(
                path,
                pools,
                _params.amountIn
            );

            int256[] memory deltas;
            deltas = IBalancer(_params.dexRouter).batchSwap(
                IBalancer.SwapKind.GIVEN_IN,
                steps,
                assets,
                fundManagement,
                limits,
                _params.deadline
            );
            if (_params.tokenOut == NATIVE_CURRENCY) {
                WNative.withdraw(WNative.balanceOf(address(this)));
            }
            return [_params.amountIn, uint256(deltas[deltas.length - 1] * -1), 0];
        }

        IBalancer.SingleSwap memory singleSwap = IBalancer.SingleSwap({
            poolId: pools[0],
            kind: IBalancer.SwapKind.GIVEN_IN,
            assetIn: IAsset(path[0]),
            assetOut: IAsset(path[1]),
            amount: _params.amountIn,
            userData: "0x"
        });
        uint256 amountOut = IBalancer(_params.dexRouter).swap(
            singleSwap,
            fundManagement,
            _params.amountOutMin,
            _params.deadline
        );
        if (_params.tokenOut == NATIVE_CURRENCY) {
            WNative.withdraw(WNative.balanceOf(address(this)));
        }
        return [_params.amountIn, amountOut, 0];
    }
}
