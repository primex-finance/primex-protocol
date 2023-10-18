// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ tokenTransfersLibrary, errorsLibrary }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("PrimexPricingLibrary", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });
};
