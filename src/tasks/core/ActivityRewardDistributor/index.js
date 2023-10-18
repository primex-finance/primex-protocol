// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:ActivityRewardDistributor", "Deploy ActivityRewardDistributor contract", require("./ActivityRewardDistributor.deploy"))
  .addParam("pmx", "The address of PMXToken")
  .addOptionalParam("primexDNS", "The address of usd contract")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("treasury", "The address of treasury contract")
  .addOptionalParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("traderBalanceVault", "The address of traderBalanceVault contract");

task(
  "ActivityRewardDistributor:setupBucket",
  "Setup bucket for early rewards in ActivityRewardDistributor contract",
  require("./setupBucket"),
)
  .addOptionalParam("lenderRewardDistributor", "The address of lenderRewardDistributor contract")
  .addParam("bucket", "The address of bucket for update")
  .addParam("increaseAmount", "The amount that increases the total reward distributed in the bucket")
  .addParam("rewardPerDay", "The amount distributed per day")
  .addParam("role", "LENDER or TRADER. Setup bucket for on of the roles");
