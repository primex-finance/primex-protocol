// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {ARB_NITRO_ORACLE} from "./Constants.sol";

contract GasPriceOracleArbitrumOne is AggregatorV3Interface {
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    function description() external pure override returns (string memory) {
        return "ArbitrumOne Gas Price Oracle";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(
        uint80 /*_roundId */
    )
        external
        pure
        override
        returns (
            uint80 /*roundId*/,
            int256 /*answer*/,
            uint256 /*startedAt*/,
            uint256 /*updatedAt*/,
            uint80 /*answeredInRound*/
        )
    {
        revert("Not implemented");
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (, , , , , uint256 gasPrice) = ARB_NITRO_ORACLE.getPricesInWei();
        return (0, int256(gasPrice), block.timestamp, block.timestamp, 0);
    }
}
