// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

import {IPriceOracleStorage, IPriceOracleStorageV2, IPriceOracleStorageV3, IPriceOracleStorageV4} from "./IPriceOracleStorage.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {ISupraOraclePull} from "../interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "../interfaces/ISupraSValueFeed.sol";
import {IOrallyVerifierOracle} from "@orally-network/solidity-sdk/IOrallyVerifierOracle.sol";
import {IStorkVerify} from "../interfaces/IStorkVerify.sol";
import {IUniswapV2LPOracle} from "../UniswapV2LPOracle/IUniswapV2LPOracle.sol";

abstract contract PriceOracleStorage is IPriceOracleStorage, ERC165Upgradeable {
    address public override registry;
    address public override eth;
    address public override gasPriceFeed;

    // PriceDrop of asset A relative to asset B
    mapping(address => mapping(address => uint256)) public override pairPriceDrops;

    /**
     * @notice The mapping stores priceDrop feeds adresses associated with the asset pair.
     * @dev 'The address of the first asset in the pair' -> ' The address of the second asset in the pair' -> 'priceDrop feed address'
     */
    mapping(address => mapping(address => address)) internal oraclePriceDropFeeds;

    /**
     * @notice The mapping stores price feeds for currency pairs.
     * @dev 'base currency address' -> 'quote currency address' -> 'price feed address'
     */
    mapping(address => mapping(address => address)) internal chainLinkPriceFeeds;
}

abstract contract PriceOracleStorageV2 is IPriceOracleStorageV2, PriceOracleStorage {
    IPyth public override pyth;
    uint256 public override timeTolerance;
    // baseToken => chainlink usd price feed;
    mapping(address => address) public override chainlinkPriceFeedsUsd;

    // baseToken => the pyth ID of the price feed to get an update for
    mapping(address => bytes32) public override pythPairIds;

    // oracleType => corresponding oracle address
    mapping(uint256 => address) public override univ3TypeOracles;

    // univ3TypeOracles => tokenA => tokenB
    mapping(uint256 => mapping(address => mapping(address => bool))) public override univ3TrustedPairs;
}

abstract contract PriceOracleStorageV3 is IPriceOracleStorageV3, PriceOracleStorageV2 {
    ISupraOraclePull public override supraPullOracle;
    ISupraSValueFeed public override supraStorageOracle;

    // assetA => assetB => feedId
    mapping(address => mapping(address => SupraDataFeedId)) public override supraDataFeedID;
    address public override usdt;
    address public override treasury;
}

abstract contract PriceOracleStorageV4 is IPriceOracleStorageV4, PriceOracleStorageV3 {
    //orally oracle
    IOrallyVerifierOracle public override orallyOracle;
    // asset => asset => orallySymbol
    mapping(address => mapping(address => string)) public override orallySymbol;

    uint256 public override orallyTimeTolerance;
    //stork oracle
    IStorkVerify public override storkVerify;
    address public override storkPublicKey;
    // asset => asset => pair (BTCUSD)
    mapping(address => mapping(address => string)) public override storkAssetPairId;

    // Curve oracleType => corresponding oracle address
    mapping(CurveOracleKind => address) public override curveTypeOracles;
    // ERC4626 token to its underlying asset
    // for the statAToken it will be underlying asset of the AToken
    mapping(address => address) public override eip4626TokenToUnderlyingAsset;

    mapping(address => bool) public override isUniswapV2LP;

    IUniswapV2LPOracle public override uniswapV2LPOracle;
}
