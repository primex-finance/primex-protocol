// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PositionManagerExtension", {
    primexPricingLibrary: primexPricingLibrary.address,
    positionLibrary: positionLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PositionManagerExtension", "Test", "PrimexCore"];
module.exports.dependencies = ["PrimexPricingLibrary", "PositionLibrary", "Errors"];
