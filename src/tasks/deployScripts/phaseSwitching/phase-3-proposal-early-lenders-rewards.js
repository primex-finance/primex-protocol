// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const { earlyLendersRewards } = require("./config.json");
  await run("phaseSwitch:setupBucketsWithRewardsConfiguration", {
    totalReward: earlyLendersRewards.totalReward,
    rewardPerDay: earlyLendersRewards.rewardPerDay,
    role: "LENDER",
  });
  await run("phaseSwitch:earlyRewardsInBuckets", {
    role: "LENDER",
  });
  console.log("=== finished ===");
};
