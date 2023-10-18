// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getNamedSigners, getContract } }) => {
  const { deployer } = await getNamedSigners();
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");
  await run("deploy:EPMXToken", {
    recipient: deployer.address,
    registry: registry.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["EPMXToken", "Test", "PrimexCore"];
module.exports.dependencies = ["Errors", "Registry"];
