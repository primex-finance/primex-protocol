// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ errorsLibrary }, { getNamedAccounts, ethers: { getContract }, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("TokenTransfersLibrary", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
