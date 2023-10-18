// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const { spotTradingRewards } = require("./config.json");
  await run("phaseSwitch:setupSpotTradingRewardDistributorInPM");
  await run("phaseSwitch:SpotTradingRewardDistributor", { rewardPerPeriod: spotTradingRewards.rewardPerPeriod });
  console.log("=== finished ===");
};
