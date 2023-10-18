// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {PositionLibrary} from "../libraries/PositionLibrary.sol";
import "./../libraries/Errors.sol";

import {IPositionManager} from "../PositionManager/IPositionManager.sol";
import {IPriceOracle} from "../PriceOracle/IPriceOracle.sol";
import {IConditionalClosingManager} from "../interfaces/IConditionalClosingManager.sol";
import {ITrailingStopCCM} from "../interfaces/ITrailingStopCCM.sol";

contract TrailingStopCCM is IConditionalClosingManager, ITrailingStopCCM, IERC165 {
    using WadRayMath for uint256;

    uint256 private constant CM_TYPE = 3;

    IPriceOracle public immutable priceOracle;

    constructor(address _priceOracle) {
        _require(
            IERC165(_priceOracle).supportsInterface(type(IPriceOracle).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        priceOracle = IPriceOracle(_priceOracle);
    }

    /**
     * @inheritdoc IConditionalClosingManager
     */
    function canBeClosedBeforeSwap(
        PositionLibrary.Position calldata _position,
        bytes calldata _params,
        bytes calldata _additionalParams
    ) public view override returns (bool result) {
        if (_params.length == 0 || _additionalParams.length == 0) return false;
        CanBeClosedParams memory params = abi.decode(_params, (CanBeClosedParams));
        AdditionalParams memory additionalParams = abi.decode(_additionalParams, (AdditionalParams));
        (result, ) = _canBeClosed(
            _position,
            additionalParams.lowPriceRoundNumber,
            additionalParams.highPriceRoundNumber,
            params
        );
    }

    /**
     * @inheritdoc IConditionalClosingManager
     */
    function canBeClosedAfterSwap(
        PositionLibrary.Position calldata _position,
        bytes calldata _params,
        bytes calldata _additionalParams,
        uint256,
        uint256
    ) public view override returns (bool) {
        return canBeClosedBeforeSwap(_position, _params, _additionalParams);
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return
            _interfaceId == type(IERC165).interfaceId ||
            _interfaceId == type(IConditionalClosingManager).interfaceId ||
            _interfaceId == type(ITrailingStopCCM).interfaceId;
    }

    /**
     * @notice Checks if a position can be closed.
     * @dev The round numbers represent the specific round of price data to
     fetch from the price feeds for the base asset and quote asset.
     * @param _position The position details.
     * @param _lowPriceRoundNumbers The low price round numbers.
     * @param _highPriceRoundNumbers The high price round numbers.
     * @param _params The parameters for closing the position.
     * @return A tuple indicating whether the position can be closed and
     the minPossibleTime, that indicates the earliest point in time at which the low price might have occurred.
     */
    function _canBeClosed(
        PositionLibrary.Position calldata _position,
        uint80[2] memory _lowPriceRoundNumbers,
        uint80[2] memory _highPriceRoundNumbers,
        CanBeClosedParams memory _params
    ) internal view returns (bool, uint256) {
        _require(
            _lowPriceRoundNumbers[0] >= _highPriceRoundNumbers[0] &&
                _lowPriceRoundNumbers[1] >= _highPriceRoundNumbers[1],
            Errors.LOW_PRICE_ROUND_IS_LESS_HIGH_PRICE_ROUND.selector
        );

        (address basePriceFeed, address quotePriceFeed) = priceOracle.getPriceFeedsPair(
            _position.positionAsset,
            _position.soldAsset
        );

        (uint256 highPrice, ) = _getPriceFromFeeds(
            _position,
            basePriceFeed,
            quotePriceFeed,
            _highPriceRoundNumbers[0],
            _highPriceRoundNumbers[1],
            true
        );
        if (highPrice < _params.activationPrice) return (false, 0);

        (uint256 lowPrice, uint256 minPossibleTime) = _getPriceFromFeeds(
            _position,
            basePriceFeed,
            quotePriceFeed,
            _lowPriceRoundNumbers[0],
            _lowPriceRoundNumbers[1],
            false // lowPrice timestamp is higher than highPrice timestamp, so no need to check it
        );
        return (lowPrice < highPrice.wmul(WadRayMath.WAD - _params.trailingDelta), minPossibleTime);
    }

    /**
     * @notice Calculates the price from price feeds for a given position.
     * @param position The position for which the price needs to be calculated.
     * @param basePriceFeed The address of the base price feed.
     * @param quotePriceFeed The address of the quote price feed.
     * @param roundBaseFeed The round ID of the base price feed.
     * @param roundQuoteFeed The round ID of the quote price feed.
     * @param needCheckTimestamp A boolean flag indicating whether to check the timestamp.
     * @return The calculated price in WAD format as ratio between the base price and the quote price,
     and the timestamp of the latest price.
     */
    function _getPriceFromFeeds(
        PositionLibrary.Position calldata position,
        address basePriceFeed,
        address quotePriceFeed,
        uint80 roundBaseFeed,
        uint80 roundQuoteFeed,
        bool needCheckTimestamp
    ) internal view returns (uint256, uint256) {
        return
            PrimexPricingLibrary.getPriceFromFeeds(
                AggregatorV3Interface(basePriceFeed),
                AggregatorV3Interface(quotePriceFeed),
                roundBaseFeed,
                roundQuoteFeed,
                needCheckTimestamp ? position.createdAt : 0
            );
    }
}
