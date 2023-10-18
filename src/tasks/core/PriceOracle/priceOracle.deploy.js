// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ registry, errorsLibrary, eth }, { getNamedAccounts, deployments: { deploy }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("PriceOracle", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, eth],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
