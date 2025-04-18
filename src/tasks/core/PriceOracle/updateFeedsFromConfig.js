// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../../config/configUtils.js");
const { USD, NATIVE_CURRENCY } = require("../../../test/utils/constants");

module.exports = async function ({ priceOracle }, { ethers: { getContract, getContractAt } }) {
  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }
  const { pricefeeds, priceDropfeeds, assets, gasPriceFeed } = getConfig();

  function getAssetAddress(assetName) {
    if (assetName === "usd") return USD;
    if (assetName === "native") return NATIVE_CURRENCY;
    if (assets[assetName] === undefined) throw new Error(`There isn't ${assetName} asset in config`);
    return assets[assetName];
  }
  function getFeedsData(feedsArray) {
    if (feedsArray === undefined) return [];
    const priceFeedsData = [];
    for (const feed in feedsArray) {
      if (typeof feedsArray[feed] === "object") continue;
      const feedAssets = feed.split("-");
      const feedData = {
        token0: getAssetAddress(feedAssets[0]),
        token1: getAssetAddress(feedAssets[1]),
        feed: feedsArray[feed],
      };
      priceFeedsData.push(feedData);
    }
    return priceFeedsData;
  }

  function getFeedsDataForChainLinkUsd(feedsArray) {
    const priceFeedData = {
      tokens: [],
      feeds: [],
    };
    if (feedsArray === undefined) return priceFeedData;

    for (const feed in feedsArray) {
      if (typeof feedsArray[feed] === "object") continue;
      const feedAssets = feed.split("-");
      priceFeedData.tokens.push(getAssetAddress(feedAssets[0]));
      priceFeedData.feeds.push(feedsArray[feed]);
    }
    return priceFeedData;
  }
  const priceFeedsDataPrimary = getFeedsDataForChainLinkUsd(pricefeeds);
  const priceFeedsDataSecondary = pricefeeds?.selfDeployed
    ? getFeedsDataForChainLinkUsd(pricefeeds?.selfDeployed)
    : { tokens: [], feeds: [] };

  const priceFeedsData = {
    tokens: [...priceFeedsDataPrimary.tokens, ...priceFeedsDataSecondary.tokens],
    feeds: [...priceFeedsDataPrimary.feeds, ...priceFeedsDataSecondary.feeds],
  };
  const priceDropFeedsData = getFeedsData(priceDropfeeds).concat(getFeedsData(priceDropfeeds?.selfDeployed));

  await run("priceOracle:updateChainlinkPriceFeedsUsd", { updatePriceFeeds: JSON.stringify(priceFeedsData), priceOracle: priceOracle });
  await run("priceOracle:updatePriceDropFeed", {
    updatePriceDropFeeds: JSON.stringify(priceDropFeedsData),
    priceOracle: priceOracle,
  });

  priceOracle = await getContractAt("PriceOracle", priceOracle);
  if (gasPriceFeed !== undefined) {
    const tx = await priceOracle.setGasPriceFeed(gasPriceFeed);
    await tx.wait();
  }
};
