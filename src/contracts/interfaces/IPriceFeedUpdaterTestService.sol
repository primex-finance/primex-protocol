// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexAggregatorV3TestService} from "../TestnetServices/PrimexAggregatorV3TestService.sol";

interface IPriceFeedUpdaterTestService {
    struct PriceFeedStatus {
        bool isNeedUpdate;
        PrimexAggregatorV3TestService priceFeed;
        uint256 lastAverageDexPrice;
    }

    struct PriceFeed {
        address token0;
        address token1;
        PrimexAggregatorV3TestService priceFeed;
    }

    function addRouter(address _newRouter) external;

    function deleteRouter(uint256 _index) external;

    function setDivider(uint256 _multiplier) external;

    function checkArrayPriceFeed(PriceFeed[] memory _priceFeeds) external returns (PriceFeedStatus[] memory);

    function updateArrayPriceFeed(
        PrimexAggregatorV3TestService[] memory _priceFeeds,
        int256[] memory _newAnswers
    ) external;

    function checkPriceFeed(PriceFeed memory _priceFeed) external returns (PriceFeedStatus memory);

    function updatePriceFeed(PrimexAggregatorV3TestService _priceFeed, int256 _newAnswer) external;

    function getRouters() external view returns (address[] memory _routers);
}
