// SPDX-License-Identifier: BUSL-1.1
const { getConfig, getConfigByName } = require("../../config/configUtils");

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");

  let uniswapV3Factory;
  let twapInterval = "60";
  let poolUpdateInterval = "86400";

  if (process.env.TEST) {
    uniswapV3Factory = (await getContract("UniswapV3Factory")).address;
  } else {
    const { dexes } = getConfig();
    uniswapV3Factory = dexes?.uniswapv3?.factory;
    const generalConfig = getConfigByName("generalConfig.json");
    poolUpdateInterval = generalConfig.poolUpdateInterval;
    twapInterval = generalConfig.twapInterval;
  }

  await run("deploy:UniswapPriceFeed", {
    registry: registry.address,
    uniswapV3Factory: uniswapV3Factory,
    twapInterval: twapInterval,
    poolUpdateInterval: poolUpdateInterval,
  });
};
module.exports.tags = ["UniswapPriceFeed", "Test", "PrimexCore"];
const dependencies = ["Registry"];
if (process.env.TEST) dependencies.push("Dexes");
module.exports.dependencies = dependencies;
