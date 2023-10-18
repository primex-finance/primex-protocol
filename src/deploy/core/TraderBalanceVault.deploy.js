// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:TraderBalanceVault", {
    registry: registry.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    whiteBlackList: whiteBlackList.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["TraderBalanceVault", "Test", "PrimexCore"];
module.exports.dependencies = ["Errors", "Registry", "TokenTransfersLibrary", "PrimexProxyAdmin", "WhiteBlackList"];
