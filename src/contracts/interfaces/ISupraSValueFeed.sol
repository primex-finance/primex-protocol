// (c) 2024 Primex.finance
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/* solhint-disable var-name-mixedcase */
interface ISupraSValueFeed {
    struct derivedData {
        int256 roundDifference;
        uint256 derivedPrice;
        uint256 decimals;
    }

    struct priceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    function getDerivedSvalue(
        uint256 pair_id_1,
        uint256 pair_id_2,
        uint256 operation
    ) external view returns (derivedData memory);

    function getSvalue(uint256 _pairIndex) external view returns (priceFeed memory);
}
