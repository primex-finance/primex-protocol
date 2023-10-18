// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PrimexProxyAdmin", {
    registry: registry.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PrimexProxyAdmin", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "Errors"];
