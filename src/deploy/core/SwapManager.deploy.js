// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseUnits },
  },
}) => {
  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const traderBalanceVault = await getContract("TraderBalanceVault");
  const priceOracle = await getContract("PriceOracle");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:SwapManager", {
    registry: registry.address,
    primexDNS: primexDNS.address,
    traderBalanceVault: traderBalanceVault.address,
    priceOracle: priceOracle.address,
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    whiteBlackList: whiteBlackList.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["SwapManager", "Test", "PrimexCore"];
module.exports.dependencies = [
  "PrimexDNS",
  "WhiteBlackList",
  "Registry",
  "TraderBalanceVault",
  "PriceOracle",
  "PrimexPricingLibrary",
  "TokenTransfersLibrary",
  "Errors",
];
