// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, errorsLibrary, tokenTransfersLibrary, tokenApproveLibrary },
  { getNamedAccounts, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();

  return await deploy("BucketExtension", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      Errors: errorsLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      TokenApproveLibrary: tokenApproveLibrary,
    },
  });
};
