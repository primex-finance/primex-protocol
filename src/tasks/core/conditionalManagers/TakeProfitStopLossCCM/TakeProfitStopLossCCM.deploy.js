// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, registry, positionLibrary, primexDNS, priceOracle, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContractAt, getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const takeProfitStopLossCCM = await deploy("TakeProfitStopLossCCM", {
    from: deployer,
    args: [registry],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      PositionLibrary: positionLibrary,
      Errors: errorsLibrary,
    },
  });

  if (takeProfitStopLossCCM.newlyDeployed) {
    const TakeProfitStopLossCCM = await getContractAt("TakeProfitStopLossCCM", takeProfitStopLossCCM.address);
    const initializeTx = await TakeProfitStopLossCCM.initialize(primexDNS, priceOracle);
    await initializeTx.wait();

    const primexDNScontract = await getContractAt("PrimexDNS", primexDNS);
    const addCCM = await primexDNScontract.setConditionalManager("2", takeProfitStopLossCCM.address);
    await addCCM.wait();
  }

  return takeProfitStopLossCCM;
};
