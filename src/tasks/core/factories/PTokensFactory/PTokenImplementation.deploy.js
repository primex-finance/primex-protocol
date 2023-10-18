// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ errorsLibrary }, { ethers: { getContract }, deployments: { deploy }, getNamedAccounts }) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("PToken", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
