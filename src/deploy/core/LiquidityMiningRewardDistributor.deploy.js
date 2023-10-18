// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");

module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseEther },
  },
}) => {
  const PMXToken = await getContract("EPMXToken");
  const treasury = await getContract("Treasury");
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");

  const { LiquidityMiningRD } = getConfigByName("generalConfig.json");
  const SECONDS_PER_DAY = 24 * 60 * 60;

  const reinvestmentRate = parseEther(LiquidityMiningRD.reinvestmentRate).toString();
  const reinvestmentDuration = (LiquidityMiningRD.reinvestmentDurationInDays * SECONDS_PER_DAY).toString();
  await run("deploy:LiquidityMiningRewardDistributor", {
    treasury: treasury.address,
    registry: registry.address,
    reinvestmentRate: reinvestmentRate,
    reinvestmentDuration: reinvestmentDuration,
    pmx: PMXToken.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["LiquidityMiningRewardDistributor", "Test", "PrimexCore"];
module.exports.dependencies = [
  "PrimexDNS",
  "WhiteBlackList",
  "Registry",
  "EPMXToken",
  "TraderBalanceVault",
  "PrimexProxyAdmin",
  "Treasury",
  "Errors",
];
