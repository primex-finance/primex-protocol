// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getNamedSigners, getContract } }) => {
  const { deployer } = await getNamedSigners();
  const registry = await getContract("Registry", deployer.address);
  const errorsLibrary = await getContract("Errors");
  const primexProxyAdmin = await getContract("PrimexProxyAdmin");
  await run("deploy:BucketsFactory", {
    registry: registry.address,
    primexProxyAdmin: primexProxyAdmin.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["BucketsFactory", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "DebtTokensFactory", "Errors", "WhiteBlackList", "PTokensFactory", "BucketImplementation", "PrimexProxyAdmin"];
