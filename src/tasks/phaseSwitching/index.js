// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "phaseSwitch:setupSpotTradingRewardDistributorInPM",
  "Set SpotTradingRewardDistributor in PositionManager",
  require("./phase-2/setupSpotTradingRewardDistributorInPM"),
)
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task("phaseSwitch:SpotTradingRewardDistributor", "Set reward per period", require("./phase-2/setSpotTradingRewardDistributor"))
  .addParam("rewardPerPeriod", "Amount of reward per period")
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task(
  "phaseSwitch:TopUpSpotTradingRewardDistributor",
  "Top up pmx balance in SpotTradingRewardDistributor",
  require("./phase-2/topUpSpotTradingRewardDistributor"),
).addParam("pmxAmount", "Amount of pmx to top-up distributor's balance");

task(
  "phaseSwitch:setupBucketsWithRewardsConfiguration",
  "Setup buckets with a specific rewards configuration",
  require("./phase-3-4/setupBucketsWithRewardsConfiguration.js"),
)
  .addParam("totalReward", "Total reward")
  .addParam("rewardPerDay", "Reward per day")
  .addParam("role", "Role to setup - TRADER or LENDER")
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task(
  "phaseSwitch:earlyRewardsInBuckets",
  "Setup early rewards in all deployed buckets for LENDER and TRADER roles with predefined values",
  require("./phase-3-4/setupEarlyRewardsInBuckets.js"),
)
  .addParam("role", "Role to setup - TRADER or LENDER")
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task(
  "phaseSwitch:TopUpActivityRewardDistributor",
  "Top up pmx balance in ActivityRewardDistributor",
  require("./phase-3-4/topUpActivityRewardDistributor"),
).addParam("pmxAmount", "Amount of pmx to top-up distributor's balance");

task(
  "phaseSwitch:bonusNFTs",
  "Activate FeeDecreaser and InterestIncreaser in all deployed buckets",
  require("./phase-5/activateBonusNFTs.js"),
)
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task(
  "phaseSwitch:migrateEpmxToPmx",
  "Update address of PMX token to new address, upgrade Reward contracts",
  require("./phase-6/migrateEpmxToPmx.js"),
)
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task(
  "phaseSwitch:updateRewardConfigurationsInBuckets",
  "Update Reward configurations in Buckets",
  require("./phase-6/updateRewardConfigurationsInBuckets.js"),
)
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task("phaseSwitch:updateRewardDistributors", "Update Reward contracts addresses", require("./phase-6/updateRewardDistributors.js"))
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution")
  .addOptionalParam("delay", "Delay in timelock contract");

task("phaseSwitch:deployRewardDistributors", "Deploy Reward contracts", require("./phase-6/deployRewardDistributors.js"));
