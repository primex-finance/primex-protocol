// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const errorsLibrary = await getContract("Errors");
  await run("deploy:PrimexPricingLibrary", {
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PrimexPricingLibrary", "Test","PrimexCore"];
module.exports.dependencies = ["TokenTransfersLibrary", "Errors"];
