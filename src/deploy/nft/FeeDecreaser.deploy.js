// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const bonusNft = await getContract("PMXBonusNFT");
  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:FeeDecreaser", {
    bonusNft: bonusNft.address,
    registry: registry.address,
    primexDNS: primexDNS.address,
    whiteBlackList: whiteBlackList.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["FeeDecreaser", "Test"];
module.exports.dependencies = ["PMXBonusNFT", "Registry", "PrimexDNS", "WhiteBlackList", "PrimexProxyAdmin", "Errors"];
