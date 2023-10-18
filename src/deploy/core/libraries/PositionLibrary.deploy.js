// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const limitOrderLibrary = await getContract("LimitOrderLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PositionLibrary", {
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    limitOrderLibrary: limitOrderLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PositionLibrary", "Test","PrimexCore"];
module.exports.dependencies = ["PrimexPricingLibrary", "TokenTransfersLibrary", "LimitOrderLibrary", "Errors"];
