// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ errorsLibrary }, { getNamedAccounts, deployments: { deploy }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  return await deploy("Registry", {
    contract: "PrimexRegistry",
    from: deployer,
    args: [],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
