// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const PriceOracle = await getContract("PriceOracle");

  await run("deploy:UniswapV2LPOracle", {
    priceOracle: PriceOracle.address,
  });
};
module.exports.tags = ["UniswapV2LPOracle", "Test", "PrimexCore"];
const dependencies = ["PriceOracle"];
if (process.env.TEST) dependencies.push("Dexes");
module.exports.dependencies = dependencies;
