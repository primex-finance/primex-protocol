// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const positionManager = await getContract("PositionManager");
  const traderBalanceVault = await getContract("TraderBalanceVault");
  const swapManager = await getContract("SwapManager");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const limitOrderLibrary = await getContract("LimitOrderLibrary");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:LimitOrderManager", {
    registry: registry.address,
    primexDNS: primexDNS.address,
    positionManager: positionManager.address,
    traderBalanceVault: traderBalanceVault.address,
    swapManager: swapManager.address,
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    limitOrderLibrary: limitOrderLibrary.address,
    whiteBlackList: whiteBlackList.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["LimitOrderManager", "Test", "PrimexCore"];
module.exports.dependencies = [
  "PrimexDNS",
  "Registry",
  "WhiteBlackList",
  "PositionManager",
  "TraderBalanceVault",
  "SwapManager",
  "PrimexPricingLibrary",
  "TokenTransfersLibrary",
  "LimitOrderLibrary",
  "PositionLibrary",
  "PrimexProxyAdmin",
  "Errors",
];
