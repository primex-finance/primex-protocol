// SPDX-License-Identifier: BUSL-1.1
const { getConfig, getConfigByName } = require("../../config/configUtils");

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");

  const { dexes } = getConfig();
  const generalConfig = getConfigByName("generalConfig.json");
  const twapInterval = generalConfig.twapInterval;

  const algebraDexes = ["quickswapv3", "camelotv3"];
  algebraDexes.forEach(async dexName => {
    const factory = dexes?.[dexName]?.factory;
    if (factory) {
      await run("deploy:AlgebraPriceFeed", {
        registry: registry.address,
        algebraV3Factory: factory,
        twapInterval: twapInterval,
      });
    }
  });
};
module.exports.tags = ["AlgebraPriceFeed", "PrimexCore"];
const dependencies = ["Registry"];
module.exports.dependencies = dependencies;
