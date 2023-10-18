// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");
  const primexProxyAdmin = await getContract("PrimexProxyAdmin");
  await run("deploy:PTokensFactory", {
    registry: registry.address,
    primexProxyAdmin: primexProxyAdmin.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PTokensFactory", "Test", "PrimexCore"];
module.exports.dependencies = ["PTokenImplementation", "WhiteBlackList", "Errors", "Registry", "PrimexProxyAdmin"];
