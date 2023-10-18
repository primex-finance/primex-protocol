// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const oracle = await getContract("PriceOracle");
  const pmx = await getContract("EPMXToken");
  const treasury = await getContract("Treasury");

  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:SpotTradingRewardDistributor", {
    registry: registry.address,
    priceOracle: oracle.address,
    pmx: pmx.address,
    treasury: treasury.address,
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["SpotTradingRewardDistributor", "Test", "PrimexCore"];
module.exports.dependencies = [
  "Registry",
  "PrimexPricingLibrary",
  "TokenTransfersLibrary",
  "PriceOracle",
  "EPMXToken",
  "Errors",
  "Treasury",
  "PrimexProxyAdmin",
  "WhiteBlackList",
];
