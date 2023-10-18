// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, tokenTransfersLibrary, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("LimitOrderLibrary", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });
};
