// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexDNS = await getContract("PrimexDNS");
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");
  await run("deploy:Reserve", { primexDNS: primexDNS.address, registry: registry.address, errorsLibrary: errorsLibrary.address });
};

module.exports.tags = ["Reserve", "Test", "PrimexCore"];
module.exports.dependencies = ["PrimexDNS", "Registry", "Errors", "PrimexProxyAdmin", "WhiteBlackList"];
