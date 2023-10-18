// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
  const PositionLibrary = await getContract("PositionLibrary");
  const LimitOrderLibrary = await getContract("LimitOrderLibrary");
  const TakeProfitStopLossCCM = await getContract("TakeProfitStopLossCCM");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PrimexLens", {
    primexPricingLibrary: PrimexPricingLibrary.address,
    positionLibrary: PositionLibrary.address,
    limitOrderLibrary: LimitOrderLibrary.address,
    takeProfitStopLossCCM: TakeProfitStopLossCCM.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PrimexLens", "Test", "PrimexCore"];
module.exports.dependencies = ["PrimexPricingLibrary", "Errors", "PositionLibrary", "LimitOrderLibrary", "TakeProfitStopLossCCM"];
