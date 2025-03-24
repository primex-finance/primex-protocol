// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {CurveBaseOracle} from "./CurveBaseOracle.sol";

import {ICurveAddressProvider} from "../interfaces/curve/ICurveAddressProvider.sol";
import {ICurveReentrencyWrapper} from "../interfaces/curve/ICurveReentrencyWrapper.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ICurveBaseOracle} from "./ICurveBaseOracle.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {USD} from "../Constants.sol";

import "../libraries/Errors.sol";

abstract contract CurveStableOracleStorage is CurveBaseOracle {
    // pool => flag
    mapping(address => bool) internal isDynamicArray;
}

/**
 * @title CurveStableOracle
 * @author BlueberryProtocol
 * @notice Oracle contract that provides price feeds for Curve stable LP tokens.
 */

contract CurveStableOracle is CurveStableOracleStorage {
    /*//////////////////////////////////////////////////////////////////////////
                                      CONSTANTS
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev Max gas for reentrancy check.
    uint256 private constant _MAX_GAS = 10_000;

    /*//////////////////////////////////////////////////////////////////////////
                                     CONSTRUCTOR
    //////////////////////////////////////////////////////////////////////////*/
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /*//////////////////////////////////////////////////////////////////////////
                                      FUNCTIONS
    //////////////////////////////////////////////////////////////////////////*/
    /**
     * @notice Initializes the contract
     * @param _addressProvider Address of the curve address provider
     * @param _primexPriceOracle The base oracle instance.
     * @param _primexRegistry Address of the owner of the contract.
     */
    function initialize(
        ICurveAddressProvider _addressProvider,
        IPriceOracleV2 _primexPriceOracle,
        IAccessControl _primexRegistry
    ) external override initializer {
        __CurveBaseOracle_init(_addressProvider, _primexPriceOracle, _primexRegistry);
    }

    /// @inheritdoc ICurveBaseOracle
    function getPrice(address crvLp, bytes[] calldata tokensUsdOracleData) external override returns (uint256) {
        (address pool, address[] memory tokens, uint256 virtualPrice) = _getPoolInfo(crvLp);
        _require(tokensUsdOracleData.length == tokens.length, Errors.ORACLE_DATA_AND_TOKENS_LENGTH_MISMATCH.selector);
        if (_checkReentrant(pool, tokens.length)) _revert(Errors.REENTRANCY_RISK.selector);

        uint256 minPrice = type(uint256).max;
        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 tokenPrice = primexPriceOracle.getExchangeRate(tokens[i], USD, tokensUsdOracleData[i]);
            if (tokenPrice < minPrice) minPrice = tokenPrice;
        }

        // Calculate LP token price using the minimum underlying token price
        return (minPrice * virtualPrice) / WadRayMath.WAD;
    }

    /// @inheritdoc CurveBaseOracle
    function _checkReentrant(address _pool, uint256 _numTokens) internal view override returns (bool) {
        ICurveReentrencyWrapper pool = ICurveReentrencyWrapper(_pool);

        uint256 gasStart = gasleft();

        //  solhint-disable no-empty-blocks
        if (isDynamicArray[_pool]) {
            uint256[] memory amounts;
            try pool.remove_liquidity{gas: _MAX_GAS}(0, amounts) {} catch (bytes memory) {}
        } else if (_numTokens == 2) {
            uint256[2] memory amounts;
            try pool.remove_liquidity{gas: _MAX_GAS}(0, amounts) {} catch (bytes memory) {}
        } else if (_numTokens == 3) {
            uint256[3] memory amounts;
            try pool.remove_liquidity{gas: _MAX_GAS}(0, amounts) {} catch (bytes memory) {}
        } else if (_numTokens == 4) {
            uint256[4] memory amounts;
            try pool.remove_liquidity{gas: _MAX_GAS}(0, amounts) {} catch (bytes memory) {}
        }

        uint256 gasSpent;
        unchecked {
            gasSpent = gasStart - gasleft();
        }

        // If the gas spent is greater than the maximum gas, then the call is not-vulnerable to
        // read-only reentrancy
        return gasSpent <= _MAX_GAS;
    }

    /**
     * @notice Hook that is called after the registerCurveLp func
     * @param _tokenInfo struct with token info related to Curve Tokens
     */
    function _afterRegisterCurveLp(TokenInfo memory _tokenInfo) internal override {
        ICurveReentrencyWrapper pool = ICurveReentrencyWrapper(_tokenInfo.pool);

        uint256 gasStart = gasleft();

        uint256[] memory amounts;
        try pool.remove_liquidity{gas: _MAX_GAS}(0, amounts) {} catch (bytes memory) {}

        uint256 gasSpent;
        unchecked {
            gasSpent = gasStart - gasleft();
        }
        if (gasSpent > _MAX_GAS) {
            isDynamicArray[_tokenInfo.pool] = true;
        }
    }

    /// @notice Fallback function to receive Ether.
    // solhint-disable-next-line comprehensive-interface
    receive() external payable {}
}
