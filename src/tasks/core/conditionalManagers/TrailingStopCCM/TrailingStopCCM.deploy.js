// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, positionLibrary, priceOracle, primexDNS, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContractAt, getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const trailingStopCCM = await deploy("TrailingStopCCM", {
    from: deployer,
    args: [priceOracle],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      PositionLibrary: positionLibrary,
      Errors: errorsLibrary,
    },
  });

  if (trailingStopCCM.newlyDeployed) {
    const primexDNScontract = await getContractAt("PrimexDNS", primexDNS);
    const addCCM = await primexDNScontract.setConditionalManager("3", trailingStopCCM.address);
    await addCCM.wait();
  }

  return trailingStopCCM;
};
