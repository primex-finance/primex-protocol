// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ errorsLibrary }, { deployments: { deploy }, getNamedAccounts, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("InterestRateStrategy", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
