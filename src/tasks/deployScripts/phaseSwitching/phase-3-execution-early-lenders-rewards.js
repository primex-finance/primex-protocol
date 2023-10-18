// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const { earlyLendersRewards } = require("./config.json");
  // pmxAmount should be equal to sum of totalReward in all buckets
  await run("phaseSwitch:earlyRewardsInBuckets", {
    role: "LENDER",
    isExecute: true,
  });
  await run("phaseSwitch:TopUpActivityRewardDistributor", { pmxAmount: earlyLendersRewards.pmxAmountToTransfer });
  await run("phaseSwitch:setupBucketsWithRewardsConfiguration", {
    totalReward: earlyLendersRewards.totalReward,
    rewardPerDay: earlyLendersRewards.rewardPerDay,
    role: "LENDER",
    isExecute: true,
  });

  console.log("=== finished ===");
};
