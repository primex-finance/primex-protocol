// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PMXBonusNFT", {
    registry: registry.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["PMXBonusNFT", "Test"];
module.exports.dependencies = ["PrimexDNS", "WhiteBlackList", "Registry", "Errors", "PrimexProxyAdmin"];
