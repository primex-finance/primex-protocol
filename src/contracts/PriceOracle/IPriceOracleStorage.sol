// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

interface IPriceOracleStorage {
    function registry() external view returns (address);

    function eth() external view returns (address);

    function gasPriceFeed() external view returns (address);

    function pairPriceDrops(address, address) external view returns (uint256);
}

interface IPriceOracleStorageV2 is IPriceOracleStorage {
    enum OracleType {
        Pyth,
        Chainlink,
        Uniswapv3
    }

    struct OracleRoute {
        address tokenTo;
        OracleType oracleType;
        bytes oracleData;
    }

    function pyth() external view returns (IPyth);

    function timeTolerance() external view returns (uint256);

    function chainlinkPriceFeedsUsd(address) external view returns (address);

    function pythPairIds(address) external view returns (bytes32);

    function univ3TypeOracles(uint256) external view returns (address);

    function univ3TrustedPairs(uint256, address, address) external view returns (bool);
}
