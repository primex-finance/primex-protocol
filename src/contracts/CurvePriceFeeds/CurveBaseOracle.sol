// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {ICurveBaseOracle} from "./ICurveBaseOracle.sol";
import {ICurveRegistry} from "../interfaces/curve/ICurveRegistry.sol";
import {ICurveCryptoSwapRegistry, ICurveSwapFactory} from "../interfaces/curve/ICurveCryptoSwapRegistry.sol";
import {ICurvePool} from "../interfaces/curve/ICurvePool.sol";
import {ICurveAddressProvider} from "../interfaces/curve/ICurveAddressProvider.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {SMALL_TIMELOCK_ADMIN} from "../Constants.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "../libraries/Errors.sol";

/**
 * @title Curve Base Oracle
 * @notice Abstract base oracle for Curve LP token price feeds.
 */
abstract contract CurveBaseOracle is ICurveBaseOracle, ERC165Upgradeable {
    /*//////////////////////////////////////////////////////////////////////////
                                      structs 
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * @notice Struct to store token info related to Curve Tokens
     * @param pool Address of the Curve pool.
     * @param tokens tokens in the Curve liquidity pool.
     * @param registryIndex Index of the registry to use for a given pool.
     * @param registry Address of the registry
     * @dev This registry index is associated with a given pool type.
     *      0 - Main Curve Registry
     *      5 - CryptoSwap Curve Registry
     *      7 - Meta Curve Registry
     */
    struct TokenInfo {
        address pool;
        address[] tokens;
        uint256 registryIndex;
        address registry;
    }

    /*//////////////////////////////////////////////////////////////////////////
                                       STORAGE 
    //////////////////////////////////////////////////////////////////////////*/
    /// @dev Primex's registry contract
    IAccessControl public override primexRegistry;

    /// @dev Base oracle source
    IPriceOracleV2 public primexPriceOracle;

    /// @dev Address provider for Curve-related contracts.
    ICurveAddressProvider private addressProvider;
    /// @dev Mapping of Curve Lp token to token info.
    mapping(address => TokenInfo) private tokenInfo;

    /*//////////////////////////////////////////////////////////////////////////
                                     CONSTRUCTOR
    //////////////////////////////////////////////////////////////////////////*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /*//////////////////////////////////////////////////////////////////////////
                                     MODIFIERS
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(primexRegistry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /*//////////////////////////////////////////////////////////////////////////
                                      FUNCTIONS
    //////////////////////////////////////////////////////////////////////////*/
    /* solhint-disable func-name-mixedcase */
    /**
     * @notice Initializes the contract
     * @param _addressProvider Address of the curve address provider
     * @param _primexPriceOracle The base oracle instance.
     * @param _primexRegistry Address of the owner of the contract.
     */
    function __CurveBaseOracle_init(
        ICurveAddressProvider _addressProvider,
        IPriceOracleV2 _primexPriceOracle,
        IAccessControl _primexRegistry
    ) internal {
        _require(
            ERC165Upgradeable(address(_primexRegistry)).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        addressProvider = _addressProvider;
        primexPriceOracle = _primexPriceOracle;
        primexRegistry = _primexRegistry;
    }

    /* solhint-enable func-name-mixedcase */

    /**
     * @notice Registers Curve LP token with the oracle.
     * @param crvLp Address of the Curve LP token.
     */
    function registerCurveLp(
        address crvLp,
        address registry,
        uint256 registryIndex,
        address[] calldata tokens
    ) external onlyRole(SMALL_TIMELOCK_ADMIN) {
        if (crvLp == address(0)) _revert(Errors.ZERO_ADDRESS.selector);
        address pool = _setTokens(crvLp, registry, registryIndex, tokens);
        TokenInfo memory _tokenInfo = TokenInfo(pool, tokens, registryIndex, registry);
        tokenInfo[crvLp] = _tokenInfo;
        _afterRegisterCurveLp(_tokenInfo);
        if (_checkReentrant(pool, tokens.length)) _revert(Errors.REENTRANCY_RISK.selector);
    }

    /**
     * @notice Fetches the token info for a given LP token.
     * @param crvLp Curve LP Token address
     * @return TokenInfo struct of given token
     */
    function getTokenInfo(address crvLp) public view returns (TokenInfo memory) {
        return tokenInfo[crvLp];
    }

    /// @inheritdoc ICurveBaseOracle
    function getPoolInfo(
        address crvLp
    ) external view returns (address pool, address[] memory coins, uint256 virtualPrice) {
        return _getPoolInfo(crvLp);
    }

    /// @inheritdoc ICurveBaseOracle
    function getAddressProvider() external view override returns (ICurveAddressProvider) {
        return addressProvider;
    }

    /// @dev Logic for getPoolInfo.
    function _getPoolInfo(
        address crvLp
    ) internal view returns (address pool, address[] memory ulTokens, uint256 virtualPrice) {
        TokenInfo memory _tokenInfo = getTokenInfo(crvLp);
        if (_tokenInfo.pool == address(0)) _revert(Errors.ORACLE_NOT_SUPPORT_LP.selector);

        // If the registry index is 0, use the main Curve registry.
        if (_tokenInfo.registryIndex == 0) {
            pool = _tokenInfo.pool;
            ulTokens = _tokenInfo.tokens;
            virtualPrice = ICurveRegistry(_tokenInfo.registry).get_virtual_price_from_lp_token(crvLp);

            return (pool, ulTokens, virtualPrice);
        }

        // If the registry index is 5, use the CryptoSwap Curve registry.
        // If the registry index is 7, use the Meta Curve registry.
        if (_tokenInfo.registryIndex == 5 || _tokenInfo.registryIndex == 7) {
            pool = _tokenInfo.pool;
            ulTokens = _tokenInfo.tokens;
            virtualPrice = ICurveCryptoSwapRegistry(_tokenInfo.registry).get_virtual_price_from_lp_token(crvLp);

            return (pool, ulTokens, virtualPrice);
        }
        if (_tokenInfo.registryIndex == 8) {
            pool = _tokenInfo.pool;
            ulTokens = _tokenInfo.tokens;
            virtualPrice = ICurvePool(pool).get_virtual_price();

            return (pool, ulTokens, virtualPrice);
        }
    }

    /**
     * @notice Internal function to fetch the tokens in a given Curve liquidity pool.
     * @param crvLp The address of the Curve liquidity pool token (LP token).
     * @param registry Address of the Curve registry
     * @param registryIndex The index of the registry to use for a given pool.
     * @param tokens An array of tokens in the Curve liquidity pool.
     * @return pool The address of the Curve pool.
     */
    function _setTokens(
        address crvLp,
        address registry,
        uint256 registryIndex,
        address[] calldata tokens
    ) internal view returns (address pool) {
        // main Curve registry
        if (registryIndex == 0) {
            pool = ICurveRegistry(registry).get_pool_from_lp_token(crvLp);
            (uint256 n, ) = ICurveRegistry(registry).get_n_coins(pool);
            _require(tokens.length == n, Errors.INCORRECT_TOKENS_LENGTH.selector);
            // Main Curve Registry index: 0
            return pool;
        }

        // CryptoSwap Curve registry
        if (registryIndex == 5 || registryIndex == 7) {
            pool = ICurveCryptoSwapRegistry(registry).get_pool_from_lp_token(crvLp);
            uint256 n = ICurveCryptoSwapRegistry(registry).get_n_coins(pool);
            _require(tokens.length == n, Errors.INCORRECT_TOKENS_LENGTH.selector);
            // CryptoSwap Curve Registry index: 5 OR Meta Curve Curve Registry index: 7
            return pool;
        }
        // CurveStableswapFactoryNG / Curve Sidechain/L2 Factory
        if (registryIndex == 8) {
            pool = crvLp;
            uint256 n = ICurveSwapFactory(registry).get_n_coins(pool);
            _require(tokens.length == n, Errors.INCORRECT_TOKENS_LENGTH.selector);
            // index: 8
            return pool;
        }

        _revert(Errors.ORACLE_NOT_SUPPORT_LP.selector);
    }

    /**
     * @notice Internal function to check for reentrancy within Curve pools.
     * @param pool The address of the Curve pool to check.
     * @param numTokens The number of tokens in the pool.
     */
    function _checkReentrant(address pool, uint256 numTokens) internal view virtual returns (bool);

    /**
     * @notice Hook that is called after the registerCurveLp func
     * @param _tokenInfo struct with token info related to Curve Tokens
     */
    function _afterRegisterCurveLp(TokenInfo memory _tokenInfo) internal virtual {}
}
