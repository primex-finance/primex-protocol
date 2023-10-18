// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const whiteBlackList = await deploy("WhiteBlackList", {
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
      Errors: errorsLibrary,
    },
  });

  if (whiteBlackList.newlyDeployed) {
    const whiteBlackListContract = await getContractAt("WhiteBlackList", whiteBlackList.address);
    const tx = await whiteBlackListContract.addAddressToWhitelist(registry);
    await tx.wait();
  }

  return whiteBlackList;
};
