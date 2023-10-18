// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const { earlyTradersRewards } = require("./config.json");
  // pmxAmount should be equal to sum of totalReward in all buckets
  await run("phaseSwitch:TopUpActivityRewardDistributor", { pmxAmount: earlyTradersRewards.pmxAmountToTransfer });
  await run("phaseSwitch:setupBucketsWithRewardsConfiguration", {
    totalReward: earlyTradersRewards.totalReward,
    rewardPerDay: earlyTradersRewards.rewardPerDay,
    role: "TRADER",
    isExecute: true,
  });
  await run("phaseSwitch:earlyRewardsInBuckets", {
    role: "TRADER",
    isExecute: true,
  });
  console.log("=== finished ===");
};
