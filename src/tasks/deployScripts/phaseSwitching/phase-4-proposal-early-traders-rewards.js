// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const { earlyTradersRewards } = require("./config.json");
  await run("phaseSwitch:setupBucketsWithRewardsConfiguration", {
    totalReward: earlyTradersRewards.totalReward,
    rewardPerDay: earlyTradersRewards.rewardPerDay,
    role: "TRADER",
  });
  await run("phaseSwitch:earlyRewardsInBuckets", {
    role: "TRADER",
  });
  console.log("=== finished ===");
};
