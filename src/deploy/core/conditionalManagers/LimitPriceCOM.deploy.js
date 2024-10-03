// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexDNS = await getContract("PrimexDNS");
  const priceOracle = await getContract("PriceOracle");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const limitOrderLibrary = await getContract("LimitOrderLibrary");
  const keeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const pm = await getContract("PositionManager");
  const errorsLibrary = await getContract("Errors");
  const registry = await getContract("Registry");


  await run("deploy:LimitPriceCOM", {
    primexDNS: primexDNS.address,
    priceOracle: priceOracle.address,
    primexPricingLibrary: primexPricingLibrary.address,
    limitOrderLibrary: limitOrderLibrary.address,
    registry: registry.address,
    positionManager: pm.address,
    keeperRewardDistributor: keeperRewardDistributor.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["LimitPriceCOM", "Test", "PrimexCore"];
module.exports.dependencies = ["PriceOracle", "PrimexDNS", "Errors", "LimitOrderLibrary", "PrimexPricingLibrary", "PositionManager", "KeeperRewardDistributor", "Registry"];
