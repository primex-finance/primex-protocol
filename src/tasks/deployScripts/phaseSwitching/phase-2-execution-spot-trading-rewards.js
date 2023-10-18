// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const { spotTradingRewards } = require("./config.json");
  await run("phaseSwitch:setupSpotTradingRewardDistributorInPM", { isExecute: true });
  await run("phaseSwitch:TopUpSpotTradingRewardDistributor", { pmxAmount: spotTradingRewards.pmxAmountToTransfer });
  await run("phaseSwitch:SpotTradingRewardDistributor", { rewardPerPeriod: spotTradingRewards.rewardPerPeriod, isExecute: true });
  console.log("=== finished ===");
};
