// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ priceOracle, updatePriceDropFeeds }, { ethers: { getContract, getContractAt } }) {
  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }
  const oracleContract = await getContractAt("PriceOracle", priceOracle);
  updatePriceDropFeeds = JSON.parse(updatePriceDropFeeds);
  for (let i = 0; i < updatePriceDropFeeds.length; i++) {
    const priceDropFeed = updatePriceDropFeeds[i];
    if (priceDropFeed.token0 === undefined) throw new Error("token0 is undefined");
    if (priceDropFeed.token1 === undefined) throw new Error("token1 is undefined");
    if (priceDropFeed.feed === undefined) throw new Error("priceDropFeed is undefined");

    const tx = await oracleContract.updatePriceDropFeed(priceDropFeed.token0, priceDropFeed.token1, priceDropFeed.feed);
    await tx.wait();
    console.log(`priceOracle.updatePriceDropFeeds(${priceDropFeed.token0},${priceDropFeed.token1},${priceDropFeed.feed})`);
  }
};
