// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseUnits },
  },
}) => {
  const ePMXToken = await getContract("EPMXToken");
  const registry = await getContract("Registry");
  const traderBalanceVault = await getContract("TraderBalanceVault");
  const lendingPrimexNFT = await getContract("LendingPrimexNFT");
  const tradingPrimexNFT = await getContract("TradingPrimexNFT");
  const farmingPrimexNFT = await getContract("FarmingPrimexNFT");

  await run("deploy:TiersManager", {
    registry: registry.address,
    traderBalanceVault: traderBalanceVault.address,
    lendingNFT: lendingPrimexNFT.address,
    tradingNFT: tradingPrimexNFT.address,
    farmingNFT: farmingPrimexNFT.address,
    earlyPmx: ePMXToken.address,
    tiers: JSON.stringify([]),
    thresholds: JSON.stringify([]),
  });
};
module.exports.tags = ["TiersManager", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "EPMXToken", "TraderBalanceVault", "LendingPrimexNFT", "FarmingPrimexNFT", "TradingPrimexNFT"];
