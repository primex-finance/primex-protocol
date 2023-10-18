// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "deploy:LiquidityMiningRewardDistributor",
  "Deploy LiquidityMiningRewardDistributor contract",
  require("./LiquidityMiningRewardDistributor.deploy"),
)
  .addParam("pmx", "The address of PMXToken")
  .addOptionalParam("primexDNS", "The address of the PrimexDNS contract")
  .addOptionalParam("whiteBlackList", "The address of the WhiteBlackList contract")
  .addOptionalParam("treasury", "Address of treasury contract")
  .addParam("reinvestmentRate", "Percent of current reward that user can earn with reinvesting")
  .addParam("reinvestmentDuration", "Duration of reinvestment phase after liquidity mining deadline")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
