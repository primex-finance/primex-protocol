// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ registry, errorsLibrary }, { getNamedAccounts, deployments: { deploy }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();
  if (registry === undefined) {
    registry = (await getContract("Registry")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("PrimexProxyAdmin", {
    from: deployer,
    args: [registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
