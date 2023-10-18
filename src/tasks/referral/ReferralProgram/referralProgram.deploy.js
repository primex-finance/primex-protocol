// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ registry, errorsLibrary }, { getNamedAccounts, deployments: { deploy }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("ReferralProgram", {
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
};
