// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../config/configUtils.js");

module.exports = async function ({ _ }, { ethers: { getContract } }) {
  const { assets, pricefeeds } = getConfig();

  let allPriceFeeds = pricefeeds;
  if (allPriceFeeds === undefined) {
    allPriceFeeds = {};
    allPriceFeeds.selfDeployed = {};
  }
  allPriceFeeds.selfDeployed = {};

  for (const tokenSymbol in assets) {
    const name = `${tokenSymbol}-usd`;
    const feed = allPriceFeeds[tokenSymbol + "-usd"];

    if (feed === undefined) {
      await run("deploy:PrimexAggregatorV3TestService", { name: name });
      const feed = await getContract(`PrimexAggregatorV3TestService ${name} price feed`);
      allPriceFeeds.selfDeployed[name] = feed.address;
    }
  }

  // TODO: set answer for native pricefeed for mumbai and moonbaseAlpha
  if (!(process.env.MUMBAI || process.env.MOONBASE)) {
    if (allPriceFeeds["weth-usd"] !== undefined) {
      allPriceFeeds["native-usd"] = allPriceFeeds["weth-usd"];
    } else if (allPriceFeeds.selfDeployed["weth-usd"] !== undefined) {
      allPriceFeeds.selfDeployed["native-usd"] = allPriceFeeds.selfDeployed["weth-usd"];
    }
  }

  setConfig("pricefeeds", allPriceFeeds);

  const names = ["weth-usdc", "wbtc-usdc", "link-usdc"];

  const priceDropfeeds = {};
  priceDropfeeds.selfDeployed = {};
  for (const name of names) {
    await run("deploy:PrimexAggregatorV3TestService", { name: name + " priceDrop" });
    const feed = await getContract(`PrimexAggregatorV3TestService ${name} priceDrop price feed`);
    priceDropfeeds.selfDeployed[name] = feed.address;
  }
  setConfig("priceDropfeeds", priceDropfeeds);

  console.log("price feeds are deployed!");
};
