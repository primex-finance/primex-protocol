// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("PrimexLensPart2", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      Errors: errorsLibrary,
    },
  });
};
