// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  await run("deploy:SynchronizationBotLensQuickswap", { tokenTransfersLibrary: tokenTransfersLibrary.address });
};

module.exports.tags = ["SynchronizationBotLensQuickswapTestService", "Test", "TestnetService"];
module.exports.dependencies = ["TokenTransfersLibrary"];
