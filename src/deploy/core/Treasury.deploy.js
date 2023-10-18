// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getNamedSigners, getContract } }) => {
  const { deployer } = await getNamedSigners();
  const registry = await getContract("Registry", deployer.address);
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:Treasury", {
    registry: registry.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["Treasury", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "TokenTransfersLibrary", "Errors", "PrimexProxyAdmin", "WhiteBlackList"];
