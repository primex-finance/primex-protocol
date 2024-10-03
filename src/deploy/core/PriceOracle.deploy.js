// SPDX-License-Identifier: BUSL-1.1
const { getConfig, getConfigByName } = require("../../config/configUtils");
const { NATIVE_CURRENCY } = require("../../test/utils/constants");

module.exports = async ({ run, network, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");
  const uniswapPriceFeed = await getContract("UniswapPriceFeed");
  const { isETHNative, assets, pyth, supraPullOracle, supraStorageOracle } = getConfig();
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
  });

  if (!process.env.TEST) {
    const priceOracle = await getContract("PriceOracle");
    const pythPriceFeedsIds = getConfigByName("pythPriceFeedsIds.json");
    const { timeTolerance } = getConfigByName("generalConfig.json");
    await priceOracle.setTimeTolerance(timeTolerance);

    const assetsArray = [];
    const priceFeedIds = [];

    for (const key in pythPriceFeedsIds) {
      if (key === "matic" && network.name === "polygon") {
        assetsArray.push(NATIVE_CURRENCY);
        priceFeedIds.push(pythPriceFeedsIds[key]);
        continue;
      }
      if (key === "eth" && (network.name === "ethereum" || network.name === "arbitrumOne")) {
        assetsArray.push(NATIVE_CURRENCY);
        priceFeedIds.push(pythPriceFeedsIds[key]);
        continue;
      }
      if (assets[key]) {
        assetsArray.push(assets[key]);
        priceFeedIds.push(pythPriceFeedsIds[key]);
      }
    }
    await priceOracle.updatePythPairId(assetsArray, priceFeedIds);
  }
};

module.exports.tags = ["PriceOracle", "Test", "PrimexCore"];
const dependencies = ["Registry", "EPMXToken", "PrimexProxyAdmin", "Errors", "UniswapPriceFeed", "Treasury"];
if (process.env.TEST) dependencies.push("MockPyth");
module.exports.dependencies = dependencies;
