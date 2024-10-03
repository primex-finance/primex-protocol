// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ priceOracle, updatePriceFeeds }, { ethers: { getContract, getContractAt } }) {
  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }

  priceOracle = await getContractAt("PriceOracle", priceOracle);
  updatePriceFeeds = JSON.parse(updatePriceFeeds);

  const tx = await priceOracle.updateChainlinkPriceFeedsUsd(updatePriceFeeds.tokens, updatePriceFeeds.feeds);
  await tx.wait();

  if (process.env.TEST === undefined) {
    for (let i = 0; i < updatePriceFeeds.tokens.length; i++) {
      console.log(`priceOracle.updateChainlinkPriceFeedsUsd(${updatePriceFeeds.tokens[i]}, ${updatePriceFeeds.feeds[i]})`);
    }
  }
};
