// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getNamedSigners, getContract } }) => {
  const { deployer } = await getNamedSigners();
  const registry = await getContract("Registry", deployer.address);
  const errorsLibrary = await getContract("Errors");

  await run("deploy:ReferralProgram", {
    registry: registry.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["ReferralProgram", "Test"];
module.exports.dependencies = ["Registry", "Errors", "PrimexProxyAdmin"];
