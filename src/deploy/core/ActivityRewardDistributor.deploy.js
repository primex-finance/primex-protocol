// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const treasury = await getContract("Treasury");
  const pmx = await getContract("EPMXToken");
  const primexDNS = await getContract("PrimexDNS");
  const errorsLibrary = await getContract("Errors");
  const traderBalanceVault = await getContract("TraderBalanceVault");
  const whiteBlackList = await getContract("WhiteBlackList");

  await run("deploy:ActivityRewardDistributor", {
    registry: registry.address,
    treasury: treasury.address,
    pmx: pmx.address,
    primexDNS: primexDNS.address,
    whiteBlackList: whiteBlackList.address,
    errorsLibrary: errorsLibrary.address,
    traderBalanceVault: traderBalanceVault.address,
  });
};

module.exports.tags = ["ActivityRewardDistributor", "Test", "PrimexCore"];
module.exports.dependencies = [
  "Registry",
  "PrimexDNS",
  "WhiteBlackList",
  "EPMXToken",
  "Errors",
  "TraderBalanceVault",
  "Treasury",
  "PrimexProxyAdmin",
];
