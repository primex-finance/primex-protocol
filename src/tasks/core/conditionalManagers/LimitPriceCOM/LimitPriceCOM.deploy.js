// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexPricingLibrary, registry, limitOrderLibrary, primexDNS, priceOracle, positionManager, keeperRewardDistributor, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContractAt, getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const limitPriceCOM = await deploy("LimitPriceCOM", {
    from: deployer,
    args: [registry],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      LimitOrderLibrary: limitOrderLibrary,
      Errors: errorsLibrary,
    },
  });
  if (limitPriceCOM.newlyDeployed) {
    const LimitPriceCOM = await getContractAt("LimitPriceCOM", limitPriceCOM.address);
    const initializeTx = await LimitPriceCOM.initialize(primexDNS, priceOracle, positionManager, keeperRewardDistributor);
    await initializeTx.wait();
    const primexDNScontract = await getContractAt("PrimexDNS", primexDNS);
    const addCOM = await primexDNScontract.setConditionalManager("1", limitPriceCOM.address);
    await addCOM.wait();
  }

  return limitPriceCOM;
};
