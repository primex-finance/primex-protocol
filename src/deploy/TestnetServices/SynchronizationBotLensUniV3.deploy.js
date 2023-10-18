// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  await run("deploy:SynchronizationBotLensUniV3", { tokenTransfersLibrary: tokenTransfersLibrary.address });
};

module.exports.tags = ["SynchronizationBotLensUniV3TestService", "Test", "TestnetService"];
module.exports.dependencies = ["TokenTransfersLibrary"];
