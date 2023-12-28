// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils.js");
const { USD_DECIMALS } = require("../../test/utils/constants");

module.exports = async function (
  { _ },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  const hasUsdtPool = network.name === "devnode3";

  const {
    pricefeeds: { selfDeployed: pricefeeds },
    priceDropfeeds: { selfDeployed: priceDropfeeds },
    assets,
  } = getConfig();

  function getAssetAddress(assetName) {
    if (assetName === "usd") return assets.usdc;
    if (assets[assetName] === undefined) throw new Error(`There isn't ${assetName} asset in config`);
    return assets[assetName];
  }
  async function getFeedContract(feedAddress) {
    const feed = await getContractAt("PrimexAggregatorV3TestService", feedAddress);
    const isSet = !((await feed.latestAnswer()).isZero() || (await feed.decimals()) === 0);
    return { isSet: isSet, feed: feed };
  }
  let tx;
  // set USDCfeed separately and don't update its value in priceBot
  const usdcFeedName = "usdc-usd";
  if (pricefeeds[usdcFeedName] !== undefined) {
    const { isSet, feed: usdcFeed } = await getFeedContract(pricefeeds[usdcFeedName]);
    if (!isSet) {
      tx = await usdcFeed.setAnswer(parseUnits("0.998", USD_DECIMALS));
      await tx.wait();
    }
  }
  const priceFeedsToUpdate = [];

  for (const feed in pricefeeds) {
    if (feed === usdcFeedName) continue;
    const { isSet, feed: feedContract } = await getFeedContract(pricefeeds[feed]);
    if (!isSet) {
      const feedAssets = feed.split("-");
      if (feedAssets[0] === "native" || feedAssets[1] === "native") continue;
      if (!hasUsdtPool && feedAssets[0] === "usdt") continue;
      const feedData = {
        token0: getAssetAddress(feedAssets[0]),
        token1: getAssetAddress(feedAssets[1]),
        priceFeed: feedContract.address,
      };
      priceFeedsToUpdate.push(feedData);
    }
  }
  const decimals = 5;
  const oraclePriceDropValues = {
    "weth-usdc": "642", // WETH/USDC, more than hardcoded value, decimals = 5
    "wbtc-usdc": "575", // WBTC/USDC, more than hardcoded value, decimals = 5
    "link-usdc": "1303", // LINK/USDC, less than hardcoded value, decimals = 5
  };

  const priceDropFeedsToUpdate = [];
  const newPriceDropValues = [];

  for (const feed in priceDropfeeds) {
    const { isSet, feed: feedContract } = await getFeedContract(priceDropfeeds[feed]);
    if (!isSet) {
      if (oraclePriceDropValues[feed] === undefined) throw new Error("PriceDrop value is not set");
      newPriceDropValues.push(oraclePriceDropValues[feed]);
      priceDropFeedsToUpdate.push(feedContract.address);
      tx = await feedContract.setDecimals(decimals);
      await tx.wait();
    }
  }

  const priceFeedUpdaterTestService = await getContract("PriceFeedUpdaterTestService");
  const statuses = await priceFeedUpdaterTestService.callStatic.checkArrayPriceFeed(priceFeedsToUpdate);

  const priceFeedsToUpdateByStatus = [];
  const newValues = [];
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i].isNeedUpdate) {
      priceFeedsToUpdateByStatus.push(statuses[i].priceFeed);
      newValues.push(statuses[i].lastAverageDexPrice);
    }
  }
  const allFeedsToUpdate = priceFeedsToUpdateByStatus.concat(priceDropFeedsToUpdate);
  const allNewValues = newValues.concat(newPriceDropValues);

  tx = await priceFeedUpdaterTestService.updateArrayPriceFeed(allFeedsToUpdate, allNewValues);
  await tx.wait();

  console.log("price feeds are set up!");
};
