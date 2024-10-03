// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IUniswapPriceFeed} from "../UniswapPriceFeed/IUniswapPriceFeed.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";

import "./PriceOracleStorage.sol";
import "../libraries/Errors.sol";

import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, NATIVE_CURRENCY, EMERGENCY_ADMIN, USD} from "../Constants.sol";
import {IPriceOracleV2} from "./IPriceOracle.sol";
import {ISupraSValueFeed} from "../interfaces/ISupraSValueFeed.sol";
import {ITreasury} from "../Treasury/ITreasury.sol";

contract PriceOracle is IPriceOracleV2, PriceOracleStorageV3 {
    using WadRayMath for uint256;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param role The role identifier to check.
     */
    modifier onlyRole(bytes32 role) {
        _require(IAccessControl(registry).hasRole(role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function initialize(
        address _registry,
        address _eth,
        address _usdt,
        address _treasury
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
        eth = _eth;
        usdt = _usdt;
        _setTreasury(_treasury);
        __ERC165_init();
    }

    function setTreasury(address _treasury) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _setTreasury(_treasury);
    }

    function setPyth(address _pyth) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        pyth = IPyth(_pyth);
    }

    function setUSDT(address _usdt) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        usdt = _usdt;
    }

    function setSupraPullOracle(address _supraPullOracle) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        supraPullOracle = ISupraOraclePull(_supraPullOracle);
    }

    function setSupraStorageOracle(address _supraStorageOracle) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        supraStorageOracle = ISupraSValueFeed(_supraStorageOracle);
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function increasePairPriceDrop(
        address _assetA,
        address _assetB,
        uint256 _pairPriceDrop
    ) external override onlyRole(EMERGENCY_ADMIN) {
        _require(
            _pairPriceDrop > pairPriceDrops[_assetA][_assetB] && _pairPriceDrop <= WadRayMath.WAD / 2,
            Errors.PAIR_PRICE_DROP_IS_NOT_CORRECT.selector
        );
        _setPairPriceDrop(_assetA, _assetB, _pairPriceDrop);
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function setTimeTolerance(uint256 _timeTolerance) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        timeTolerance = _timeTolerance;
        emit TimeToleranceUpdated(_timeTolerance);
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function setPairPriceDrop(
        address _assetA,
        address _assetB,
        uint256 _pairPriceDrop
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _require(_pairPriceDrop > 0 && _pairPriceDrop < WadRayMath.WAD, Errors.PAIR_PRICE_DROP_IS_NOT_CORRECT.selector);
        _setPairPriceDrop(_assetA, _assetB, _pairPriceDrop);
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function updatePriceDropFeed(
        address assetA,
        address assetB,
        address priceDropFeed
    ) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _updatePriceDropFeed(assetA, assetB, priceDropFeed);
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function updatePriceDropFeeds(
        UpdatePriceDropFeedsParams[] calldata _updateParams
    ) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        for (uint256 i; i < _updateParams.length; i++) {
            _updatePriceDropFeed(_updateParams[i].assetA, _updateParams[i].assetB, _updateParams[i].priceDropFeed);
        }
    }

    function updateChainlinkPriceFeedsUsd(
        address[] calldata _tokens,
        address[] calldata _feeds
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _require(_tokens.length == _feeds.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < _tokens.length; i++) {
            chainlinkPriceFeedsUsd[_tokens[i]] = _feeds[i];
            emit ChainlinkPriceFeedUpdated(_tokens[i], _feeds[i]);
        }
    }

    function updatePythPairId(
        address[] calldata _tokens,
        bytes32[] calldata _priceFeedIds
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _require(_tokens.length == _priceFeedIds.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < _tokens.length; i++) {
            pythPairIds[_tokens[i]] = _priceFeedIds[i];
            emit PythPairIdUpdated(_tokens[i], _priceFeedIds[i]);
        }
    }

    function updateSupraDataFeed(
        UpdateSupraDataFeedParams[] calldata _params
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        for (uint256 i; i < _params.length; i++) {
            supraDataFeedID[_params[i].tokenA][_params[i].tokenB] = _params[i].feedData;
            emit SupraDataFeedUpdated(_params[i].tokenA, _params[i].tokenB, _params[i].feedData.id);
        }
    }

    /**
     * @inheritdoc IPriceOracleV2
     */

    function updatePullOracle(bytes[][] calldata _data, uint256[] calldata _oracleTypes) external payable override {
        _require(_data.length == _oracleTypes.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        uint256 remainingValue = msg.value;
        for (uint256 i; i < _oracleTypes.length; i++) {
            if (_oracleTypes[i] == uint256(UpdatePullOracle.Pyth)) {
                uint256 updateFee = pyth.getUpdateFee(_data[i]);
                _require(updateFee <= remainingValue, Errors.NOT_ENOUGH_MSG_VALUE.selector);
                remainingValue -= updateFee;
                pyth.updatePriceFeeds{value: updateFee}(_data[i]);
                continue;
            } else if (_oracleTypes[i] == uint256(UpdatePullOracle.Supra)) {
                supraPullOracle.verifyOracleProof(_data[i][0]);
            }
        }
        if (remainingValue > 0) {
            TokenTransfersLibrary.doTransferOutETH(treasury, remainingValue);
        }
    }

    function updateUniv3TypeOracle(
        uint256[] calldata _oracleTypes,
        address[] calldata _oracles
    ) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(_oracleTypes.length == _oracles.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < _oracleTypes.length; i++) {
            univ3TypeOracles[_oracleTypes[i]] = _oracles[i];
            emit Univ3OracleUpdated(_oracleTypes[i], _oracles[i]);
        }
    }

    function updateUniv3TrustedPair(
        UpdateUniv3TrustedPairParams[] calldata _updateParams
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        for (uint256 i; i < _updateParams.length; i++) {
            univ3TrustedPairs[_updateParams[i].oracleType][_updateParams[i].tokenA][
                _updateParams[i].tokenB
            ] = _updateParams[i].isTrusted;
            // reverse order
            univ3TrustedPairs[_updateParams[i].oracleType][_updateParams[i].tokenB][
                _updateParams[i].tokenA
            ] = _updateParams[i].isTrusted;
            emit Univ3TrustedPairUpdated(
                _updateParams[i].oracleType,
                _updateParams[i].tokenA,
                _updateParams[i].tokenB,
                _updateParams[i].isTrusted
            );
        }
    }

    function getExchangeRate(
        address assetA,
        address assetB,
        bytes calldata oracleData
    ) external payable override returns (uint256) {
        OracleRoute[] memory oracleRoutes = abi.decode(oracleData, (OracleRoute[]));
        _require(oracleRoutes.length > 0 && oracleRoutes.length < 5, Errors.WRONG_ORACLE_ROUTES_LENGTH.selector);
        _require(oracleRoutes[oracleRoutes.length - 1].tokenTo == assetB, Errors.INCORRECT_TOKEN_TO.selector);
        if (oracleRoutes.length == 3)
            _require(oracleRoutes[1].oracleType != OracleType.Uniswapv3, Errors.INCORRECT_ROUTE_SEQUENCE.selector);
        if (oracleRoutes.length == 4)
            _require(
                oracleRoutes[1].oracleType != OracleType.Uniswapv3 &&
                    oracleRoutes[0].oracleType != OracleType.Pyth &&
                    oracleRoutes[0].oracleType != OracleType.Chainlink,
                Errors.INCORRECT_ROUTE_SEQUENCE.selector
            );

        address tokenFrom = assetA;
        uint256 price = WadRayMath.WAD;
        bool uniWasChecked;

        for (uint256 i; i < oracleRoutes.length; i++) {
            if (oracleRoutes[i].oracleType == OracleType.Uniswapv3 && !uniWasChecked) {
                // try to find a direct route between the assetA and the assetB, if there is one, then revert it
                if (_checkTokenToUsd(assetA) && _checkTokenToUsd(assetB))
                    _revert(Errors.THERE_IS_DIRECT_ROUTE.selector);
                // cache var in case there are two uniswap routes in the oracleData
                uniWasChecked = true;
            }
            price = price.wmul(_getExchangeRate(tokenFrom, oracleRoutes[i]));
            tokenFrom = oracleRoutes[i].tokenTo;
        }
        return price;
    }

    function _getExchangeRate(address _assetA, OracleRoute memory _oracleRoute) internal returns (uint256) {
        bool assetAIsUsd = _assetA == USD;
        if (_oracleRoute.oracleType == OracleType.Pyth) {
            if (!assetAIsUsd) _require(_oracleRoute.tokenTo == USD, Errors.INCORRECT_PYTH_ROUTE.selector);
            bytes32 pairID = pythPairIds[assetAIsUsd ? _oracleRoute.tokenTo : _assetA];
            _require(pairID != bytes32(0), Errors.NO_PRICEFEED_FOUND.selector);
            PythStructs.Price memory price = pyth.getPrice(pairID);
            _require(
                price.publishTime >= block.timestamp - timeTolerance,
                Errors.PUBLISH_TIME_EXCEEDS_THRESHOLD_TIME.selector
            );
            // price in WAD format and invert if necessary
            return assetAIsUsd ? WadRayMath.WAD.wdiv(_convertPythPriceToWad(price)) : _convertPythPriceToWad(price);
        }
        if (_oracleRoute.oracleType == OracleType.Supra) {
            SupraDataFeedId memory feedId = supraDataFeedID[_assetA][_oracleRoute.tokenTo];
            ISupraSValueFeed.priceFeed memory feedData;
            uint256 exchangeRate;
            if (feedId.initialize) {
                feedData = supraStorageOracle.getSvalue(feedId.id);
                exchangeRate = feedData.price * 10 ** (18 - feedData.decimals);
            } else {
                feedId = supraDataFeedID[_oracleRoute.tokenTo][_assetA];
                _require(feedId.initialize, Errors.NO_PRICEFEED_FOUND.selector);
                feedData = supraStorageOracle.getSvalue(feedId.id);
                exchangeRate = WadRayMath.WAD.wdiv(feedData.price * 10 ** (18 - feedData.decimals));
            }
            _require(
                feedData.time >= block.timestamp - timeTolerance,
                Errors.PUBLISH_TIME_EXCEEDS_THRESHOLD_TIME.selector
            );
            return exchangeRate;
        }
        if (_oracleRoute.oracleType == OracleType.Chainlink) {
            if (!assetAIsUsd) _require(_oracleRoute.tokenTo == USD, Errors.INCORRECT_CHAINLINK_ROUTE.selector);
            address priceFeed = chainlinkPriceFeedsUsd[assetAIsUsd ? _oracleRoute.tokenTo : _assetA];
            _require(priceFeed != address(0), Errors.NO_PRICEFEED_FOUND.selector);

            (, int256 answer, , , ) = AggregatorV3Interface(priceFeed).latestRoundData();
            _require(answer > 0, Errors.ZERO_EXCHANGE_RATE.selector);
            // price in WAD format and invert if necessary
            return
                assetAIsUsd
                    ? WadRayMath.WAD.wdiv((uint256(answer) * 10 ** (18 - AggregatorV3Interface(priceFeed).decimals())))
                    : (uint256(answer) * 10 ** (18 - AggregatorV3Interface(priceFeed).decimals()));
        }
        uint256 oracleType = uint256(bytes32(_oracleRoute.oracleData));
        address uniOracle = univ3TypeOracles[oracleType];
        _require(uniOracle != address(0), Errors.NO_PRICEFEED_FOUND.selector);
        _require(
            univ3TrustedPairs[oracleType][_assetA][_oracleRoute.tokenTo],
            Errors.TOKEN_PAIR_IS_NOT_TRUSTED.selector
        );
        // always returns price in WAD
        return IUniswapPriceFeed(uniOracle).getExchangeRate(_assetA, _oracleRoute.tokenTo);
    }

    function _convertPythPriceToWad(PythStructs.Price memory price) internal pure returns (uint256) {
        if (price.price < 0 || price.expo > 0 || price.expo < -255) {
            _revert(Errors.INCORRECT_PYTH_PRICE.selector);
        }
        uint8 priceDecimals = uint8(uint32(-1 * price.expo));

        if (18 >= priceDecimals) {
            return uint256(uint64(price.price)) * 10 ** uint32(18 - priceDecimals);
        } else {
            return uint256(uint64(price.price)) / 10 ** uint32(priceDecimals - 18);
        }
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function getPairPriceDrop(address _assetA, address _assetB) external view override returns (uint256 priceDrop) {
        uint256 oraclePairPriceDrop = getOraclePriceDrop(_assetA, _assetB);
        uint256 pairPriceDrop = pairPriceDrops[_assetA][_assetB];
        priceDrop = pairPriceDrop > oraclePairPriceDrop ? pairPriceDrop : oraclePairPriceDrop;
        if (priceDrop > WadRayMath.WAD) return WadRayMath.WAD;
        return priceDrop;
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function getOraclePriceDropFeed(address assetA, address assetB) external view override returns (address) {
        _require(assetA != assetB, Errors.IDENTICAL_TOKEN_ADDRESSES.selector);
        address priceDropFeed = oraclePriceDropFeeds[assetA][assetB];
        _require(priceDropFeed != address(0), Errors.NO_PRICE_DROP_FEED_FOUND.selector);
        return priceDropFeed;
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function setGasPriceFeed(address priceFeed) public override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        gasPriceFeed = priceFeed;
        emit GasPriceFeedChanged(priceFeed);
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function getOraclePriceDrop(address assetA, address assetB) public view override returns (uint256) {
        address priceDropFeed = oraclePriceDropFeeds[assetA][assetB];
        if (priceDropFeed == address(0)) return 0;
        (, int256 answer, , , ) = AggregatorV3Interface(priceDropFeed).latestRoundData();
        uint256 answerDecimals = AggregatorV3Interface(priceDropFeed).decimals();
        return (uint256(answer) * 10 ** (18 - answerDecimals));
    }

    /**
     * @inheritdoc IPriceOracleV2
     */
    function getGasPrice() public view override returns (int256 price) {
        if (gasPriceFeed != address(0)) (, price, , , ) = AggregatorV3Interface(gasPriceFeed).latestRoundData();
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IPriceOracleV2).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Sets the priceDrop for a pair of assets.
     * @param _assetA The address of the first asset in the pair.
     * @param _assetB The address of the second asset in the pair.
     * @param _pairPriceDrop The priceDrop value in WAD format to be set for the pair.
     */
    function _setPairPriceDrop(address _assetA, address _assetB, uint256 _pairPriceDrop) internal {
        _require(_assetA != address(0) && _assetB != address(0), Errors.ASSET_ADDRESS_NOT_SUPPORTED.selector);
        _require(_assetA != _assetB, Errors.IDENTICAL_ASSET_ADDRESSES.selector);
        pairPriceDrops[_assetA][_assetB] = _pairPriceDrop;
        emit PairPriceDropChanged(_assetA, _assetB, _pairPriceDrop);
    }

    function _updatePriceDropFeed(address assetA, address assetB, address priceDropFeed) internal {
        _require(assetA != assetB, Errors.IDENTICAL_TOKEN_ADDRESSES.selector);
        oraclePriceDropFeeds[assetA][assetB] = priceDropFeed;
        emit PriceDropFeedUpdated(assetA, assetB, priceDropFeed);
    }

    /**
     * @dev Checks, whether a token-to-usd pair exists for the oracles Pyth, CL, and Supra.
     */
    function _checkTokenToUsd(address _token) internal view returns (bool) {
        // check pyth
        if (pythPairIds[_token] != bytes32(0)) return true;

        // check CL
        if (chainlinkPriceFeedsUsd[_token] != address(0)) return true;

        // check Supra USD
        SupraDataFeedId storage feedUsd = supraDataFeedID[_token][USD];
        if (feedUsd.initialize) return true;

        // check Supra USDT
        SupraDataFeedId storage feedUSDT = supraDataFeedID[_token][usdt];
        if (feedUSDT.initialize) return true;
        return false;
    }

    function _setTreasury(address _treasury) internal {
        _require(
            IERC165Upgradeable(_treasury).supportsInterface(type(ITreasury).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        treasury = _treasury;
    }
}
