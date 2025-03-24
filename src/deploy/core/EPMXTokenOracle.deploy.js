// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const { USD_DECIMALS } = require("../../test/utils/constants");
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseUnits },
  },
}) => {
  const registry = await getContract("Registry");

  const config = getConfigByName("generalConfig.json");
  const price = parseUnits(config.EPMXOraclePrice, USD_DECIMALS);

  const PMXPriceFeed = await run("deploy:PMXPriceFeed", {
    registry: registry.address,
    price: price.toString(),
  });

  if (PMXPriceFeed.newlyDeployed) {
    const priceOracle = await getContract("PriceOracle");
    const EPMXToken = await getContract("EPMXToken");
    const priceFeeds = { tokens: [EPMXToken.address], feeds: [PMXPriceFeed.address] };
    await run("priceOracle:updateChainlinkPriceFeedsUsd", {
      priceOracle: priceOracle.address,
      updatePriceFeeds: JSON.stringify(priceFeeds),
    });
  }
};

module.exports.tags = ["PMXPriceFeed", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "Errors", "PriceOracle", "EPMXToken"];
