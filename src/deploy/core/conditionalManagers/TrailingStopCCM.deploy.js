// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const primexDNS = await getContract("PrimexDNS");
  const priceOracle = await getContract("PriceOracle");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const errorsLibrary = await getContract("Errors");
  await run("deploy:TrailingStopCCM", {
    primexDNS: primexDNS.address,
    priceOracle: priceOracle.address,
    primexPricingLibrary: primexPricingLibrary.address,
    positionLibrary: positionLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["TrailingStopCCM", "Test"];
module.exports.dependencies = ["PriceOracle", "PositionLibrary", "PrimexPricingLibrary", "Errors"];
