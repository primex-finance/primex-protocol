// SPDX-License-Identifier: BUSL-1.1
const { getConfig, getConfigByName } = require("../../config/configUtils");
const { NATIVE_CURRENCY } = require("../../test/utils/constants");

module.exports = async ({ run, ethers: { getContract } }) => {
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
    const { assets } = getConfig();
    const pythPriceFeedsIds = getConfigByName("pythPriceFeedsIds.json");
    const assetsArray = [];
    const priceFeedIds = [];
    const assetKeys = Object.keys(assets);
    const pythPriceFeedKeys = Object.keys(pythPriceFeedsIds);

    assetKeys.forEach(assetKey => {
      if (pythPriceFeedKeys.includes(assetKey)) {
        assetsArray.push(assets[assetKey]);
        priceFeedIds.push(pythPriceFeedsIds[assetKey]);
        console.log(`For asset ${assetKey}, found pythPriceFeedId: ${pythPriceFeedsIds[assetKey]}`);
      }
    });
    await priceOracle.updatePythPairId(assetsArray, priceFeedIds);
  }
};

module.exports.tags = ["PriceOracle", "Test", "PrimexCore"];
const dependencies = ["Registry", "EPMXToken", "PrimexProxyAdmin", "Errors", "UniswapPriceFeed", "Treasury"];
if (process.env.TEST) dependencies.push("MockPyth");
module.exports.dependencies = dependencies;
