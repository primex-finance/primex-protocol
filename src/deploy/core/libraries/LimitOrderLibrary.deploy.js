// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:LimitOrderLibrary", {
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["LimitOrderLibrary", "Test","PrimexCore"];
module.exports.dependencies = ["PrimexPricingLibrary", "TokenTransfersLibrary", "Errors"];
