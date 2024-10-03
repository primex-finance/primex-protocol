// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:KeeperRewardDistributor", "Deploy KeeperRewardDistributor contract", require("./KeeperRewardDistributor.deploy"))
  .addParam("pmxPartInReward", "PMX part of the reward in WAD")
  .addParam("nativePartInReward", "Native token part of the reward in WAD")
  .addParam("positionSizeCoefficient", "The reward param which is needed to calculate rewards, in WAD")
  .addParam("additionalGas", "Additional amount that is added to gas spent")
  .addParam("defaultMaxGasPrice", "Max gas price that can be used to calculate rewards")
  .addParam("oracleGasPriceTolerance", "Percentage by which oracle gas price can be exceeded (in WAD)")
  .addParam("paymentModel", "Payment model for gas in different chains(uint)")
  .addParam("pmx", "The address of PMXToken")
  .addParam("maxGasPerPositionParams", "")
  .addParam("decreasingGasByReasonParams", "")
  .addOptionalParam("minPositionSizeMultiplier", "The multiplier to be applied if positionSizeMultiplier < this value")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("treasury", "The address of treasury contract")
  .addOptionalParam("priceOracle", "The address of priceOracle contract")
  .addOptionalParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addOptionalParam("primexPricingLibrary", "The address of the PrimexPricingLibrary")
  .addOptionalParam("tokenTransfersLibrary", "The address of the TokenTransfersLibrary")
  .addOptionalParam("errorsLibrary", "The address of the Errors library");
