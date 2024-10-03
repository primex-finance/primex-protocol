// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const routers = [];
  const dexAdapter = await getContract("DexAdapter");
  const primexDNS = await getContract("PrimexDNS");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const errorsLibrary = await getContract("Errors");

  const dexes = await primexDNS.getAllDexes();
  for (const dex of dexes) {
    // because the paraswap can't handle getAmountsOut/In
    if (dex !== "paraswap") {
      routers.push((await primexDNS.dexes(dex)).routerAddress);
    }
  }

  // we need a separate account that will update the price channels
  // so as not to block the deployer account.
  await run("deploy:PriceFeedUpdaterTestService", {
    updater: "0xAFE091b8191F63d63016137aE93Dd6C67F5C7F8f",
    dexAdapter: dexAdapter.address,
    routers: JSON.stringify(routers),
    primexPricingLibrary: primexPricingLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["PriceFeedUpdaterTestService", "Test", "TestnetService"];
module.exports.dependencies = ["DexAdapter", "PrimexDNS", "PrimexPricingLibrary", "Errors"];
