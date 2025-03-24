// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseEther },
  },
}) => {
  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const priceOracle = await getContract("PriceOracle");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");
  const tierManager = await getContract("TiersManager");

  await run("deploy:DepositManager", {
    registry: registry.address,
    primexDNS: primexDNS.address,
    priceOracle: priceOracle.address,
    whiteBlackList: whiteBlackList.address,
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
    tierManager: tierManager.address,
  });
};

module.exports.tags = ["DepositManager", "Test", "PrimexCore"];
module.exports.dependencies = ["TiersManager"];
