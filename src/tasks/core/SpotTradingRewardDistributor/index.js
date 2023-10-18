// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

const day = 60 * 60 * 24;
task(
  "deploy:SpotTradingRewardDistributor",
  "Deploy SpotTradingRewardDistributor contract",
  require("./SpotTradingRewardDistributor.deploy"),
)
  .addParam("periodDuration", "Spot trader reward period in seconds", day.toString())
  .addParam("pmx", "The address of PMXToken")
  .addOptionalParam("priceOracle", "The address of priceOracle contract")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("primexPricingLibrary", "The address of primexPricingLibrary contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("traderBalanceVault", "The address of traderBalanceVault contract")
  .addOptionalParam("treasury", "The address of Treasury contract");
