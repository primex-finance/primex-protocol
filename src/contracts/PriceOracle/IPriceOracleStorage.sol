// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {ISupraOraclePull} from "../interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "../interfaces/ISupraSValueFeed.sol";
import {IOrallyVerifierOracle} from "@orally-network/solidity-sdk/IOrallyVerifierOracle.sol";
import {IStorkVerify} from "../interfaces/IStorkVerify.sol";
import {IUniswapV2LPOracle} from "../UniswapV2LPOracle/IUniswapV2LPOracle.sol";

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
        Uniswapv3,
        Supra,
        Orally,
        Stork,
        CurveLPOracle,
        EIP4626,
        UniswapV2LP
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

interface IPriceOracleStorageV3 is IPriceOracleStorageV2 {
    struct SupraDataFeedId {
        uint256 id;
        bool initialize;
    }

    function supraPullOracle() external view returns (ISupraOraclePull);

    function supraStorageOracle() external view returns (ISupraSValueFeed);

    function supraDataFeedID(address, address) external view returns (uint256, bool);

    function usdt() external view returns (address);

    function treasury() external view returns (address);
}

interface IPriceOracleStorageV4 is IPriceOracleStorageV3 {
    enum CurveOracleKind {
        STABLE,
        TRICRYPTO,
        VOLATILE
    }

    function orallySymbol(address, address) external view returns (string memory);

    function orallyOracle() external view returns (IOrallyVerifierOracle);

    function orallyTimeTolerance() external view returns (uint256);

    function storkVerify() external view returns (IStorkVerify);

    function storkPublicKey() external view returns (address);

    function storkAssetPairId(address, address) external view returns (string memory);

    function curveTypeOracles(CurveOracleKind) external view returns (address);

    function eip4626TokenToUnderlyingAsset(address) external view returns (address);

    function isUniswapV2LP(address) external view returns (bool);

    function uniswapV2LPOracle() external view returns (IUniswapV2LPOracle);
}
