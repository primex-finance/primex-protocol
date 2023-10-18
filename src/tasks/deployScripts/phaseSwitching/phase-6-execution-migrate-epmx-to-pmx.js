// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.NEWPMX = true;
  const { earlyLendersRewards } = require("./config.json");
  // pmxAmount should be equal to sum of totalReward in all buckets
  await run("phaseSwitch:TopUpActivityRewardDistributor", { pmxAmount: earlyLendersRewards.pmxAmountToTransfer });
  await run("phaseSwitch:migrateEpmxToPmx", { isExecute: true });
  await run("phaseSwitch:updateRewardConfigurationsInBuckets", { isExecute: true });
  await run("phaseSwitch:updateRewardDistributors", { isExecute: true });
  console.log("=== finished ===");
};
