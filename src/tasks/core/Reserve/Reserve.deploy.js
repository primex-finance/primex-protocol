// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexDNS, registry, errorsLibrary },
  { getNamedAccounts, ethers: { getContract }, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const reserve = await deploy("Reserve", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [primexDNS, registry],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (reserve.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const tx = await whiteBlackList.addAddressToWhitelist(reserve.address);
    await tx.wait();
  }
  return reserve;
};
