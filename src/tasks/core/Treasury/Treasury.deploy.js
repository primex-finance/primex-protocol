// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, errorsLibrary, tokenTransfersLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();

  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  if (!tokenTransfersLibrary) {
    tokenTransfersLibrary = (await getContract("TokenTransfersLibrary")).address;
  }

  const treasury = await deploy("Treasury", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry],
        },
      },
    },
    libraries: {
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });
  if (treasury.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const tx = await whiteBlackList.addAddressToWhitelist(treasury.address);
    await tx.wait();
  }
  return treasury;
};
