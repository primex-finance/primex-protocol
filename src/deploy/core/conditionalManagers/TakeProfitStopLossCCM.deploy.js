// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexDNS = await getContract("PrimexDNS");
  const priceOracle = await getContract("PriceOracle");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const errorsLibrary = await getContract("Errors");
  const registry = await getContract("Registry");

  await run("deploy:TakeProfitStopLossCCM", {
    primexDNS: primexDNS.address,
    priceOracle: priceOracle.address,
    registry: registry.address,
    primexPricingLibrary: primexPricingLibrary.address,
    positionLibrary: positionLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["TakeProfitStopLossCCM", "Test", "PrimexCore"];
module.exports.dependencies = ["PriceOracle", "PrimexDNS", "PositionLibrary", "Errors", "PrimexPricingLibrary", "Registry"];
