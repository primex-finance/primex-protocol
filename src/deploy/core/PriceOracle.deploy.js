// SPDX-License-Identifier: BUSL-1.1
const { getConfig, getConfigByName } = require("../../config/configUtils");
const { NATIVE_CURRENCY, ETH } = require("../../test/utils/constants");

module.exports = async ({ run, network, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");
  const uniswapPriceFeed = await getContract("UniswapPriceFeed");
  const { isETHNative, assets, morphoLP, aaveLP, pyth, supraPullOracle, supraStorageOracle, orally, storkPublicKey, storkVerify } =
    getConfig();
  const eth = isETHNative ? NATIVE_CURRENCY : assets.weth;

  await run("deploy:PriceOracle", {
    registry: registry.address,
    errorsLibrary: errorsLibrary.address,
    eth: eth,
    uniswapPriceFeed: uniswapPriceFeed.address,
    pyth: process.env.TEST ? (await getContract("MockPyth")).address : pyth,
    usdt: process.env.TEST ? undefined : assets.usdt,
    supraPullOracle: !process.env.TEST ? supraPullOracle : undefined,
    supraStorageOracle: !process.env.TEST ? supraStorageOracle : undefined,
    orallyOracle: process.env.TEST ? (await getContract("OrallyVerifierOracle")).address : orally,
    storkPublicKey: process.env.TEST ? undefined : storkPublicKey,
    storkVerify: process.env.TEST ? undefined : storkVerify,
  });

  if (!process.env.TEST) {
    let tx;
    const priceOracle = await getContract("PriceOracle");
    const pythPriceFeedsIds = getConfigByName("pythPriceFeedsIds.json");
    const { timeTolerance } = getConfigByName("generalConfig.json");
    tx = await priceOracle.setTimeTolerance(timeTolerance);
    await tx.wait();

    const assetsArray = [];
    const priceFeedIds = [];

    for (const key in pythPriceFeedsIds) {
      if (key === "matic" && network.name === "polygon") {
        assetsArray.push(NATIVE_CURRENCY);
        priceFeedIds.push(pythPriceFeedsIds[key]);
        continue;
      }
      if (key === "eth" && (network.name === "ethereum" || network.name === "arbitrumOne" || network.name === "baseMainnet")) {
        assetsArray.push(NATIVE_CURRENCY);
        priceFeedIds.push(pythPriceFeedsIds[key]);
        // curve_eth
        assetsArray.push(ETH);
        priceFeedIds.push(pythPriceFeedsIds[key]);
        continue;
      }
      if (assets[key]) {
        assetsArray.push(assets[key]);
        priceFeedIds.push(pythPriceFeedsIds[key]);
      }
    }
    const rebaseTokens = [];
    const underlyingAssets = [];
    if (morphoLP) {
      for (const lp in morphoLP) {
        const token = morphoLP[lp];
        rebaseTokens.push(token.address);
        underlyingAssets.push(assets[token.basicAsset]);
      }
    }
    if (aaveLP) {
      for (const lp in aaveLP) {
        const token = aaveLP[lp];
        rebaseTokens.push(token.address);
        underlyingAssets.push(assets[token.basicAsset]);
      }
    }
    if (rebaseTokens.length > 0) {
      tx = await priceOracle.updateEIP4626TokenToUnderlyingAsset(rebaseTokens, underlyingAssets);
      await tx.wait();
    }

    if (network.name === "baseMainnet") {
      await priceOracle.setGasPriceFeed((await getContract("GasPriceOracleOptimism")).address);
    }
    tx = await priceOracle.updatePythPairId(assetsArray, priceFeedIds);
    await tx.wait();
  }
};

module.exports.tags = ["PriceOracle", "Test", "PrimexCore"];
const dependencies = ["Registry", "EPMXToken", "PrimexProxyAdmin", "Errors", "UniswapPriceFeed", "Treasury"];
if (process.env.TEST) dependencies.push("MockPyth", "MockOrally");
module.exports.dependencies = dependencies;
