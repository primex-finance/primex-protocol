// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:BestDexLens", {
    primexPricingLibrary: PrimexPricingLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["BestDexLens", "Test", "PrimexCore"];
module.exports.dependencies = ["PrimexPricingLibrary", "Errors"];
