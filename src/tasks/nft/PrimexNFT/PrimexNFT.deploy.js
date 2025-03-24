// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { deploymentName, registry, name, symbol, baseURI, implementationName },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  const { deployer } = await getNamedAccounts();

  if (!registry) {
    registry = (await getContract("Registry")).address;
  }

  const PrimexNFT = await deploy(deploymentName, {
    contract: "PrimexNFT",
    from: deployer,
    log: true,
    proxy: {
      implementationName: implementationName,
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, name, symbol, baseURI],
        },
      },
    },
  });
  return PrimexNFT;
};
