// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import "./../libraries/Errors.sol";

import {PrimexAggregatorV3TestService} from "./PrimexAggregatorV3TestService.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";
import {IPriceFeedUpdaterTestService} from "../interfaces/IPriceFeedUpdaterTestService.sol";

contract PriceFeedUpdaterTestService is IPriceFeedUpdaterTestService, AccessControl {
    bytes32 public constant DEFAULT_UPDATER_ROLE = keccak256("DEFAULT_UPDATER_ROLE");

    address[] public routers;
    IDexAdapter public dexAdapter;

    // Divide swapped token amount to reduce the impact of liquidity on the price
    uint256 public divider = 1000;

    constructor(address _updater, IDexAdapter _dexAdapter, address[] memory _routers) {
        _require(
            IERC165(address(_dexAdapter)).supportsInterface(type(IDexAdapter).interfaceId) && _updater != address(0),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        dexAdapter = _dexAdapter;

        for (uint256 i; i < _routers.length; i++) {
            _require(_routers[i] != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        }
        routers = _routers;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // DEFAULT_UPDATER_ROLE for msg.sender to facilitate initial setup and dev/stage work
        _grantRole(DEFAULT_UPDATER_ROLE, msg.sender);
        _grantRole(DEFAULT_UPDATER_ROLE, _updater);
    }

    function addRouter(address _newRouter) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _require(_newRouter != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        routers.push(_newRouter);
    }

    function deleteRouter(uint256 _index) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _require(_index < routers.length, Errors.INVALID_INDEX.selector);
        routers[_index] = routers[routers.length - 1];
        routers.pop();
    }

    function setDivider(uint256 _divider) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _require(_divider != 0, Errors.INVALID_DIVIDER.selector);
        divider = _divider;
    }

    function checkArrayPriceFeed(PriceFeed[] memory _priceFeeds) external override returns (PriceFeedStatus[] memory) {
        PriceFeedStatus[] memory statuses = new PriceFeedStatus[](_priceFeeds.length);
        for (uint256 i; i < _priceFeeds.length; i++) {
            statuses[i] = checkPriceFeed(_priceFeeds[i]);
        }
        return statuses;
    }

    function updateArrayPriceFeed(
        PrimexAggregatorV3TestService[] memory _priceFeeds,
        int256[] memory _newAnswers
    ) external override onlyRole(DEFAULT_UPDATER_ROLE) {
        _require(_priceFeeds.length == _newAnswers.length, Errors.ARRAYS_LENGTHS_IS_NOT_EQUAL.selector);
        for (uint256 i; i < _priceFeeds.length; i++) {
            _priceFeeds[i].setAnswer(_newAnswers[i]);
        }
    }

    function getRouters() external view override returns (address[] memory _routers) {
        return routers;
    }

    function checkPriceFeed(PriceFeed memory _priceFeed) public override returns (PriceFeedStatus memory) {
        _require(
            _priceFeed.token0 != address(0) &&
                _priceFeed.token1 != address(0) &&
                address(_priceFeed.priceFeed) != address(0),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        uint256 priceSum;
        uint256 denominator;
        address[] memory path = new address[](2);
        path[0] = _priceFeed.token0;
        path[1] = _priceFeed.token1;
        for (uint256 i; i < routers.length; i++) {
            bytes32 ancillaryDexData;
            IDexAdapter.DexType type_ = dexAdapter.dexType(routers[i]);
            if (type_ == IDexAdapter.DexType.UniswapV2 || type_ == IDexAdapter.DexType.Curve) {
                ancillaryDexData = 0x0;
            } else if (type_ == IDexAdapter.DexType.UniswapV3) {
                ancillaryDexData = bytes32(uint256(3000));
            }
            // slither-disable-next-line unused-return
            try
                dexAdapter.getAmountsOut(
                    IDexAdapter.GetAmountsParams({
                        encodedPath: PrimexPricingLibrary.encodePath(
                            path,
                            routers[i],
                            ancillaryDexData,
                            address(dexAdapter),
                            false
                        ),
                        amount: 10 ** IERC20Metadata(_priceFeed.token0).decimals() / divider,
                        dexRouter: routers[i]
                    })
                )
            returns (uint256[3] memory amounts) {
                // slither-disable-next-line variable-scope
                priceSum += amounts[1];
                denominator++;
            } catch {
                continue;
            }
        }
        _require(denominator != 0, Errors.DENOMINATOR_IS_0.selector);
        PriceFeedStatus memory status;
        status.priceFeed = _priceFeed.priceFeed;
        // need mul on 100 because, always in ur envs use price feeds for USD with decimals 8,
        // but calculate its price by USDC with decimals 6
        // multiplication is needed in contracts because this is where we check whether the price feeds need to be updated or not
        status.lastAverageDexPrice = ((priceSum * divider) / denominator) * 100;
        status.isNeedUpdate = uint256(_priceFeed.priceFeed.latestAnswer()) != status.lastAverageDexPrice;
        return status;
    }

    function updatePriceFeed(
        PrimexAggregatorV3TestService _priceFeed,
        int256 _newAnswer
    ) public override onlyRole(DEFAULT_UPDATER_ROLE) {
        _require(_newAnswer != 0, Errors.AMOUNT_IS_0.selector);
        _require(address(_priceFeed) != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);

        _priceFeed.setAnswer(_newAnswer);
    }
}
