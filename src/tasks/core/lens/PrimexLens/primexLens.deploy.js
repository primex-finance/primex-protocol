// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, positionLibrary, limitOrderLibrary, takeProfitStopLossCCM, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("PrimexLens", {
    from: deployer,
    args: [takeProfitStopLossCCM],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      PositionLibrary: positionLibrary,
      LimitOrderLibrary: limitOrderLibrary,
      Errors: errorsLibrary,
    },
  });
};
