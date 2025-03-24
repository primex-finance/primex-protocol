// SPDX-License-Identifier: BUSL-1.1

module.exports = async function (
  { registry, priceOracle, curveAddressProvider },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  return await deploy("CurveStableOracle", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [curveAddressProvider, priceOracle, registry],
        },
      },
    },
  });
};
