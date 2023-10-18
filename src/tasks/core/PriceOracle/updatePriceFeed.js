// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ priceOracle, updatePriceFeeds }, { ethers: { getContract, getContractAt } }) {
  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }

  priceOracle = await getContractAt("PriceOracle", priceOracle);
  updatePriceFeeds = JSON.parse(updatePriceFeeds);
  for (let i = 0; i < updatePriceFeeds.length; i++) {
    const priceFeed = updatePriceFeeds[i];
    if (priceFeed.token0 === undefined) throw new Error("token0 is undefined");
    if (priceFeed.token1 === undefined) throw new Error("token1 is undefined");
    if (priceFeed.feed === undefined) throw new Error("feed is undefined");

    const tx = await priceOracle.updatePriceFeed(priceFeed.token0, priceFeed.token1, priceFeed.feed);
    await tx.wait();
    if (process.env.TEST === undefined) {
      console.log(`priceOracle.updatePriceFeed(${priceFeed.token0},${priceFeed.token1},${priceFeed.feed})`);
    }
  }
};
