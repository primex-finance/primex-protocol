// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, positionLibrary, primexDNS, priceOracle, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContractAt, getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const takeProfitStopLossCCM = await deploy("TakeProfitStopLossCCM", {
    from: deployer,
    args: [primexDNS, priceOracle],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      PositionLibrary: positionLibrary,
      Errors: errorsLibrary,
    },
  });

  if (takeProfitStopLossCCM.newlyDeployed) {
    const primexDNScontract = await getContractAt("PrimexDNS", primexDNS);
    const addCCM = await primexDNScontract.setConditionalManager("2", takeProfitStopLossCCM.address);
    await addCCM.wait();
  }

  return takeProfitStopLossCCM;
};
