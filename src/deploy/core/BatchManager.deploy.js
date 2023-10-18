// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const positionManager = await getContract("PositionManager");
  const priceOracle = await getContract("PriceOracle");
  const registry = await getContract("Registry");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:BatchManager", {
    positionManager: positionManager.address,
    priceOracle: priceOracle.address,
    primexPricingLibrary: primexPricingLibrary.address,
    positionLibrary: positionLibrary.address,
    whiteBlackList: whiteBlackList.address,
    registry: registry.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["BatchManager", "Test", "PrimexCore"];
module.exports.dependencies = ["PositionManager", "WhiteBlackList", "Errors", "Registry"];
