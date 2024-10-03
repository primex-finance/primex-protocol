// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import "./../libraries/Errors.sol";

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {ITakeProfitStopLossCCM} from "../interfaces/ITakeProfitStopLossCCM.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";
import {BIG_TIMELOCK_ADMIN} from "../Constants.sol";

contract TakeProfitStopLossCCM is IConditionalClosingManager, ITakeProfitStopLossCCM, IERC165, Initializable {
    using WadRayMath for uint256;

    uint256 private constant CM_TYPE = 2;
    address public immutable registry;

    address public primexDNS;
    address public priceOracle;

    constructor(address _registry) {
        _require(
            IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @inheritdoc ITakeProfitStopLossCCM
     */
    function initialize(
        address _primexDNS,
        address _priceOracle
    ) external override initializer onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        primexDNS = _primexDNS;
        priceOracle = _priceOracle;
    }

    /**
     * @inheritdoc IConditionalClosingManager
     */
    function canBeClosedAfterSwap(
        PositionLibrary.Position calldata _position,
        bytes calldata _params,
        bytes calldata,
        uint256 _closeAmount,
        uint256 _borowedAssetAmount,
        bytes memory _positionSoldAssetOracleData
    ) external payable override returns (bool) {
        if (_params.length == 0) return false;
        uint256 multiplierAssetOut = 10 ** (18 - IERC20Metadata(_position.soldAsset).decimals());
        uint256 multiplierAssetIn = 10 ** (18 - IERC20Metadata(_position.positionAsset).decimals());
        uint256 exchangeRate = (_borowedAssetAmount * multiplierAssetOut).wdiv(_closeAmount * multiplierAssetIn) /
            multiplierAssetOut;
        CanBeClosedParams memory params = abi.decode(_params, (CanBeClosedParams));
        return
            (params.takeProfitPrice > 0 && exchangeRate >= params.takeProfitPrice) ||
            isStopLossReached(_position, params.stopLossPrice, _positionSoldAssetOracleData);
    }

    /**
     * @inheritdoc ITakeProfitStopLossCCM
     */
    function isStopLossReached(
        PositionLibrary.Position calldata _position,
        uint256 _stopLossPrice,
        bytes memory _positionSoldAssetOracleData
    ) public override returns (bool) {
        if (_stopLossPrice == 0) return false;
        uint256 exchangeRate = IPriceOracleV2(priceOracle).getExchangeRate(
            _position.positionAsset,
            _position.soldAsset,
            _positionSoldAssetOracleData
        );
        return _stopLossPrice >= exchangeRate;
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return
            _interfaceId == type(IERC165).interfaceId ||
            _interfaceId == type(IConditionalClosingManager).interfaceId ||
            _interfaceId == type(ITakeProfitStopLossCCM).interfaceId;
    }

    /**
     * @inheritdoc ITakeProfitStopLossCCM
     */
    function isTakeProfitReached(bytes calldata _params, uint256 exchangeRate) public pure override returns (bool) {
        CanBeClosedParams memory params = abi.decode(_params, (CanBeClosedParams));
        return params.takeProfitPrice > 0 && params.takeProfitPrice <= exchangeRate;
    }

    /**
     * @inheritdoc ITakeProfitStopLossCCM
     */
    function isStopLossReached(bytes calldata _params, uint256 oracleExchangeRate) public pure override returns (bool) {
        CanBeClosedParams memory params = abi.decode(_params, (CanBeClosedParams));
        return params.stopLossPrice >= oracleExchangeRate;
    }

    /**
     * @inheritdoc ITakeProfitStopLossCCM
     */
    function getTakeProfitStopLossPrices(bytes calldata _params) public pure override returns (uint256, uint256) {
        CanBeClosedParams memory params;
        if (_params.length > 0) {
            params = abi.decode(_params, (CanBeClosedParams));
        }
        return (params.takeProfitPrice, params.stopLossPrice);
    }

    /**
     * @notice Calculates the stop loss and take profit amounts based on the provided parameters.
     * @param positionAsset The address of the position asset.
     * @param borrowedAsset The address of the borrowed asset.
     * @param positionAmount The amount of the position.
     * @param stopLossPrice The stop loss price.
     * @param takeProfitPrice The take profit price.
     * @return stopLossAmount The calculated stop loss amount, measured in the same decimal format as the borrowed asset.
     * @return takeProfitAmount The calculated take profit amount, measured in the same decimal format as the borrowed asset.
     */
    function _calcTakeProfitStopLossAmounts(
        address positionAsset,
        address borrowedAsset,
        uint256 positionAmount,
        uint256 stopLossPrice,
        uint256 takeProfitPrice
    ) internal view returns (uint256 stopLossAmount, uint256 takeProfitAmount) {
        uint256 multiplier1 = 10 ** (18 - IERC20Metadata(positionAsset).decimals());
        uint256 multiplier2 = 10 ** (18 - IERC20Metadata(borrowedAsset).decimals());
        if (stopLossPrice != 0) {
            /**@notice  converts the positionAmount to the WAD format
                and then converts to the decimal format of the borrowed asset if necessary*/
            stopLossAmount = (positionAmount * multiplier1).wmul(stopLossPrice) / multiplier2;
        }
        if (takeProfitPrice != 0) {
            takeProfitAmount = (positionAmount * multiplier1).wmul(takeProfitPrice) / multiplier2;
        }
    }
}
