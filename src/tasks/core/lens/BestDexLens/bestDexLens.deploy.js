// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, errorsLibrary },
  { getNamedAccounts, ethers: { getContract }, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("BestDexLens", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      Errors: errorsLibrary,
    },
  });
};
