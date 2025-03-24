// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPriceOracleStorage, IPriceOracleStorageV3, IPriceOracleStorageV4} from "./IPriceOracleStorage.sol";

interface IPriceOracleV2 is IPriceOracleStorageV3 {
    event ChainlinkPriceFeedUpdated(address indexed token, address indexed priceFeed);
    event PairPriceDropChanged(address indexed assetA, address indexed assetB, uint256 pairPriceDrop);
    event PriceFeedUpdated(address indexed assetA, address indexed assetB, address indexed priceFeed);
    event PriceDropFeedUpdated(address indexed assetA, address indexed assetB, address indexed priceDropFeed);
    event GasPriceFeedChanged(address priceFeed);
    event PythPairIdUpdated(address indexed token, bytes32 indexed priceFeedId);
    event Univ3OracleUpdated(uint256 indexed oracleType, address indexed oracle);
    event TimeToleranceUpdated(uint256 timeTolerance);
    event SupraDataFeedUpdated(address indexed tokenA, address indexed tokenB, uint256 id);

    event Univ3TrustedPairUpdated(
        uint256 indexed oracleType,
        address indexed tokenA,
        address indexed tokenB,
        bool isTrusted
    );

    struct UpdateUniv3TrustedPairParams {
        uint256 oracleType;
        address tokenA;
        address tokenB;
        bool isTrusted;
    }

    enum UpdatePullOracle {
        Pyth,
        Supra,
        Orally
    }

    struct UpdateSupraDataFeedParams {
        address tokenA;
        address tokenB;
        SupraDataFeedId feedData;
    }

    /**
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @param priceDropFeed The chain link priceDrop feed address for the pair assetA/assetB
     */
    struct UpdatePriceDropFeedsParams {
        address assetA;
        address assetB;
        address priceDropFeed;
    }

    /**
     * @param _registry The address of PrimexRegistry contract
     * @param _eth Weth address if eth isn't native token of network. Otherwise set to zero address.
     * @param _usdt Address of the USDT token
     * @param _treasury Address of the Treasury
     */
    function initialize(address _registry, address _eth, address _usdt, address _treasury) external;

    /**
     * @notice Function to set (change) the pair priceDrop of the trading assets
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN.
     * @param _assetA The address of position asset
     * @param _assetB The address of borrowed asset
     * @param _pairPriceDrop The pair priceDrop (in wad)
     */
    function setPairPriceDrop(address _assetA, address _assetB, uint256 _pairPriceDrop) external;

    /**
     * @notice Increases the priceDrop of a pair of assets in the system.
     * @dev Only callable by the EMERGENCY_ADMIN role.
     * The _pairPriceDrop value must be greater than the current priceDrop value for the pair
     * and less than the maximum allowed priceDrop (WadRayMath.WAD / 2).
     * @param _assetA The address of position asset
     * @param _assetB The address of borrowed asset
     * @param _pairPriceDrop The new priceDrop value for the pair (in wad)
     */
    function increasePairPriceDrop(address _assetA, address _assetB, uint256 _pairPriceDrop) external;

    /**
     * @notice Sets the gas price feed contract address.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param priceFeed The address of the gas price feed contract.
     */
    function setGasPriceFeed(address priceFeed) external;

    /**
     * @notice Updates the priceDrop feed for a specific pair of assets.
     * @dev Add or update priceDrop feed for assets pair.
     * Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param _updateParams The array of the UpdatePriceDropFeedsParams structs
     */
    function updatePriceDropFeeds(UpdatePriceDropFeedsParams[] calldata _updateParams) external;

    /**
     * @notice Updates the priceDrop feed for a specific pair of assets.
     * @dev Add or update priceDrop feed for assets pair.
     * Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @param priceDropFeed The chain link priceDrop feed address for the pair assetA/assetB
     */
    function updatePriceDropFeed(address assetA, address assetB, address priceDropFeed) external;

    /**
     * @notice Retrieves the current gas price from the specified gas price feed.
     * @return The current gas price.
     */
    function getGasPrice() external view returns (int256);

    /**
     * @notice For a given asset pair retrieves the priceDrop rate which is the higher
     * of the oracle pair priceDrop and the historical pair priceDrop.
     * @param _assetA The address of asset A.
     * @param _assetB The address of asset B.
     * @return The priceDrop rate.
     */
    function getPairPriceDrop(address _assetA, address _assetB) external view returns (uint256);

    /**
     * @notice Retrieves the priceDrop rate between two assets based on the oracle pair priceDrop.
     * @param assetA The address of the first asset.
     * @param assetB The address of the second asset.
     * @return The priceDrop rate as a uint256 value.
     */
    function getOraclePriceDrop(address assetA, address assetB) external view returns (uint256);

    /**
     * @notice Retreives a priceDrop feed address from the oraclePriceDropFeeds mapping
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @return priceDropFeed The address of the priceDrop feed associated with the asset pair.
     */
    function getOraclePriceDropFeed(address assetA, address assetB) external view returns (address);

    /**
     * @notice Calculates exchange rate of one token to another according to the specific oracle route
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @param oracleData The list of oracles to use for price calculations
     * @return exchangeRate for assetA/assetB in 10**18 decimality
     */
    function getExchangeRate(
        address assetA,
        address assetB,
        bytes calldata oracleData
    ) external payable returns (uint256);

    /**
     * @notice Sets or updates the Chainlink price feed for the list of tokens to usd.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _tokens Array of token addresses.
     * @param _feeds Array of price feeds.
     */
    function updateChainlinkPriceFeedsUsd(address[] calldata _tokens, address[] calldata _feeds) external;

    /**
     * @notice Sets or updates the Pyth pair ids for the list of tokens.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _tokens Array of token addresses.
     * @param _priceFeedIds Array of pair ids.
     */
    function updatePythPairId(address[] calldata _tokens, bytes32[] calldata _priceFeedIds) external;

    /**
     * @notice Sets or updates the Supra price feeds for the list of tokens.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _params Array of token pairs and Supra ids.
     */

    function updateSupraDataFeed(UpdateSupraDataFeedParams[] calldata _params) external;

    /**
     * @notice Sets Uni v3-based TWAP price oracle contracts.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _oracleTypes Array of ids of TWAP contracts.
     * @param _oracles Array of TWAP contract addresses.
     */
    function updateUniv3TypeOracle(uint256[] calldata _oracleTypes, address[] calldata _oracles) external;

    /**
     * @notice Sets or updates the Supra price feeds for the list of tokens.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _updateParams Array of token pairs, their DEXs and new trusted status.
     */
    function updateUniv3TrustedPair(UpdateUniv3TrustedPairParams[] calldata _updateParams) external;

    /**
     * @notice Sets the Pyth address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _pyth the address of the Pyth oracle
     */

    function setPyth(address _pyth) external;

    /**
     * @notice Sets the Supra pull oracle address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _supraPullOracle the address of the Supra pull oracle
     */

    function setSupraPullOracle(address _supraPullOracle) external;

    /**
     * @notice Sets the Supra storage address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _supraStorageOracle the address of the Supra storage
     */
    function setSupraStorageOracle(address _supraStorageOracle) external;

    /**
     * @notice Updates pull oracle data for passed oracle types
     * @param _data An array of update data for passed oracles
     * @param _pullOracleTypes An array of oracle types  (Must conform to the UpdatePullOracle struct)
     */

    function updatePullOracle(bytes[][] calldata _data, uint256[] calldata _pullOracleTypes) external payable;

    /**
     * @notice Sets the time tolerance
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _timeTolerance Time tolerance in seconds
     */

    function setTimeTolerance(uint256 _timeTolerance) external;

    /**
     * @notice Sets the usdt address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _usdt the address of the USDT
     */

    function setUSDT(address _usdt) external;

    /**
     * @notice Sets the treasury address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _treasury the address of the treasury
     */
    function setTreasury(address _treasury) external;
}

interface IPriceOracle is IPriceOracleStorage {
    event PairPriceDropChanged(address indexed assetA, address indexed assetB, uint256 pairPriceDrop);
    event PriceFeedUpdated(address indexed assetA, address indexed assetB, address indexed priceFeed);
    event PriceDropFeedUpdated(address indexed assetA, address indexed assetB, address indexed priceDropFeed);
    event GasPriceFeedChanged(address priceFeed);

    /**
     * @param _registry The address of PrimexRegistry contract
     * @param _eth Weth address if eth isn't native token of network. Otherwise set to zero address.
     */
    function initialize(address _registry, address _eth) external;

    /**
     * @notice Function to set (change) the pair priceDrop of the trading assets
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN.
     * @param _assetA The address of position asset
     * @param _assetB The address of borrowed asset
     * @param _pairPriceDrop The pair priceDrop (in wad)
     */
    function setPairPriceDrop(address _assetA, address _assetB, uint256 _pairPriceDrop) external;

    /**
     * @notice Increases the priceDrop of a pair of assets in the system.
     * @dev Only callable by the EMERGENCY_ADMIN role.
     * The _pairPriceDrop value must be greater than the current priceDrop value for the pair
     * and less than the maximum allowed priceDrop (WadRayMath.WAD / 2).
     * @param _assetA The address of position asset
     * @param _assetB The address of borrowed asset
     * @param _pairPriceDrop The new priceDrop value for the pair (in wad)
     */
    function increasePairPriceDrop(address _assetA, address _assetB, uint256 _pairPriceDrop) external;

    /**
     * @notice Add or update price feed for assets pair. For only the admin role.
     * @param assetA The first currency within the currency pair quotation (the base currency).
     * @param assetB The second currency within the currency pair quotation (the quote currency).
     * @param priceFeed The chain link price feed address for the pair assetA/assetB
     */
    function updatePriceFeed(address assetA, address assetB, address priceFeed) external;

    /**
     * @notice Sets the gas price feed contract address.
     * @dev Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param priceFeed The address of the gas price feed contract.
     */
    function setGasPriceFeed(address priceFeed) external;

    /**
     * @notice Updates the priceDrop feed for a specific pair of assets.
     * @dev Add or update priceDrop feed for assets pair.
     * Only callable by the MEDIUM_TIMELOCK_ADMIN role.
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @param priceDropFeed The chain link priceDrop feed address for the pair assetA/assetB
     */
    function updatePriceDropFeed(address assetA, address assetB, address priceDropFeed) external;

    /**
     * @notice Requests two priceFeeds - assetA/ETH and assetB/ETH (or assetA/USD and assetB/USD).
     * @dev If there is no price feed found, the code will return a message that no price feed found.
     * @param baseAsset The first currency within the currency pair quotation (the base currency).
     * @param quoteAsset The second currency within the currency pair quotation (the quote currency).
     * @return A tuple of basePriceFeed and quotePriceFeed. The addresses of the price feed for the base asset and quote asset respectively.
     */
    function getPriceFeedsPair(address baseAsset, address quoteAsset) external view returns (address, address);

    /**
     * @notice Requests priceFeed for the actual exchange rate for an assetA/assetB pair.
     * @dev If no price feed for the pair found, USD and ETH are used as intermediate tokens.
     * A price for assetA/assetB can be derived if two data feeds exist:
     * assetA/ETH and assetB/ETH (or assetA/USD and assetB/USD).
     * If there is no price feed found, the code will return a message that no price feed found.
     * @param assetA The first currency within the currency pair quotation (the base currency).
     * @param assetB The second currency within the currency pair quotation (the quote currency).
     * @return exchangeRate for assetA/assetB in 10**18 decimality which will be recalucaled in PrimexPricingLibrary.
     * @return direction of a pair as it stored in chainLinkPriceFeeds (i.e. returns 'true' for assetA/assetB, and 'false' for assetB/assetA).
     * Throws if priceFeed wasn't found or priceFeed hasn't answer is 0.
     */
    function getExchangeRate(address assetA, address assetB) external view returns (uint256, bool);

    /**
     * @notice Retrieves the direct price feed for the given asset pair.
     * @param assetA The address of the first asset.
     * @param assetB The address of the second asset.
     * @return priceFeed The address of the direct price feed.
     */
    function getDirectPriceFeed(address assetA, address assetB) external view returns (address);

    /**
     * @notice Retrieves the current gas price from the specified gas price feed.
     * @return The current gas price.
     */
    function getGasPrice() external view returns (int256);

    /**
     * @notice For a given asset pair retrieves the priceDrop rate which is the higher
     * of the oracle pair priceDrop and the historical pair priceDrop.
     * @param _assetA The address of asset A.
     * @param _assetB The address of asset B.
     * @return The priceDrop rate.
     */
    function getPairPriceDrop(address _assetA, address _assetB) external view returns (uint256);

    /**
     * @notice Retrieves the priceDrop rate between two assets based on the oracle pair priceDrop.
     * @param assetA The address of the first asset.
     * @param assetB The address of the second asset.
     * @return The priceDrop rate as a uint256 value.
     */
    function getOraclePriceDrop(address assetA, address assetB) external view returns (uint256);

    /**
     * @notice Retreives a priceDrop feed address from the oraclePriceDropFeeds mapping
     * @param assetA The address of the first asset in the pair.
     * @param assetB The address of the second asset in the pair.
     * @return priceDropFeed The address of the priceDrop feed associated with the asset pair.
     */
    function getOraclePriceDropFeed(address assetA, address assetB) external view returns (address);
}

interface IPriceOracleV3 is IPriceOracleV2 {
    struct UpdateOrallySymbolsParams {
        string symbol; // string("tokenA/tokenB")
        address[2] tokens; // [addressA, addressB]
    }

    struct UpdateStorkPairIdsParams {
        string pair; // string("BTCUSD")
        address[2] tokens; // [btc address, usd address]
    }
    event OrallySymbolUpdated(address indexed tokenA, address indexed tokenB, string symbol);
    event OrallyTimeToleranceUpdated(uint256 timeTolerance);
    event StorkPairIdUpdated(address indexed tokenA, address indexed tokenB, string pairId);
    event CurveOracleUpdated(IPriceOracleStorageV4.CurveOracleKind indexed oracleType, address indexed oracle);
    event EIP4626TokenToUnderlyingAssetUpdated(address indexed token, address underlyingAsset);
    event AddUniswapV2LPToken(address indexed uniswapV2Token);
    event RemoveUniswapV2LPToken(address indexed uniswapV2Token);

    /**
     * @notice Sets or updates the Orally token symbol for the list of tokens (tokens order MATTERS)
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param params Array of UpdateOrallySymbolsParams struct
     */

    function updateOrallySymbols(UpdateOrallySymbolsParams[] calldata params) external;

    /**
     * @notice Sets the time tolerance specially for the orally
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _orallyTimeTolerance Time tolerance in seconds
     */

    function setOrallyTimeTolerance(uint256 _orallyTimeTolerance) external;

    /**
     * @notice Sets the orally oracle address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _orally the address of the Orally oracle
     */
    function setOrallyOracle(address _orally) external;

    /**
     * @notice Sets or updates the Stork Pair Ids
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param params Array of UpdateStorkPairIdsParams struct
     */

    function updateStorkPairIds(UpdateStorkPairIdsParams[] calldata params) external;

    /**
     * @notice Sets the stork verify address
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _storkVerify the Stork verify address
     */

    function setStorkVerify(address _storkVerify) external;

    /**
     * @notice Sets the stork public key (address)
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _storkPublicKey the Stork public key address
     */

    function setStorkPublicKey(address _storkPublicKey) external;

    function updateCurveTypeOracle(
        IPriceOracleStorageV4.CurveOracleKind[] calldata _oracleTypes,
        address[] calldata _oracles
    ) external;

    function updateEIP4626TokenToUnderlyingAsset(
        address[] calldata _rebaseTokens,
        address[] calldata _underlyingAssets
    ) external;

    /**
     * @notice Sets the flag to true for the passed tokens
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _lpTokens the addresses of lp tokens
     */

    function addUniswapV2LPTokens(address[] calldata _lpTokens) external;

    /**
     * @notice Sets the flag to false for the passed tokens
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _lpTokens the addresses of lp tokens
     */

    function removeUniswapV2LPTokens(address[] calldata _lpTokens) external;

    /**
     * @notice Sets the UniswapV2LP oracle
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _uniswapV2LPOracle the UniswapV2LP oracle address
     */

    function setUniswapV2LPOracle(address _uniswapV2LPOracle) external;
}
