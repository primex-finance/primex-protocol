// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const { USD_DECIMALS, USD } = require("../../test/utils/constants");
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

  const EPMXPriceFeed = await run("deploy:EPMXPriceFeed", {
    registry: registry.address,
    price: price.toString(),
  });

  if (EPMXPriceFeed.newlyDeployed) {
    const priceOracle = await getContract("PriceOracle");
    const EPMXToken = await getContract("EPMXToken");
    const priceFeeds = [{ token0: EPMXToken.address, token1: USD, feed: EPMXPriceFeed.address }];
    await run("priceOracle:updatePriceFeed", { priceOracle: priceOracle.address, updatePriceFeeds: JSON.stringify(priceFeeds) });
  }
};

module.exports.tags = ["EPMXPriceFeed", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "Errors", "PriceOracle", "EPMXToken"];
