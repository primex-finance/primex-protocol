// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const { getConfigByName } = require("../../config/configUtils");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const positionManager = await getContract("PositionManager");
  const priceOracle = await getContract("PriceOracle");
  const registry = await getContract("Registry");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");

  const { BatchManagerConfig } = getConfigByName("generalConfig.json");

  const gasPerPosition = BatchManagerConfig.gasPerPosition.toString();
  const gasPerBatch = BatchManagerConfig.gasPerBatch.toString();

  await run("deploy:BatchManager", {
    positionManager: positionManager.address,
    priceOracle: priceOracle.address,
    primexPricingLibrary: primexPricingLibrary.address,
    positionLibrary: positionLibrary.address,
    whiteBlackList: whiteBlackList.address,
    registry: registry.address,
    gasPerPosition: gasPerPosition,
    gasPerBatch: gasPerBatch,
    errorsLibrary: errorsLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
  });
};

module.exports.tags = ["BatchManager", "Test", "PrimexCore"];
module.exports.dependencies = ["PositionManager", "WhiteBlackList", "Errors", "Registry", "TokenTransfersLibrary"];
