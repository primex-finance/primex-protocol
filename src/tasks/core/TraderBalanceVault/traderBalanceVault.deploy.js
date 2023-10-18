// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, tokenTransfersLibrary, whiteBlackList, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const traderBalanceVault = await deploy("TraderBalanceVault", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, whiteBlackList],
        },
      },
    },
    libraries: {
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });
  if (traderBalanceVault.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(traderBalanceVault.address);
    await tx.wait();
  }
  return traderBalanceVault;
};
