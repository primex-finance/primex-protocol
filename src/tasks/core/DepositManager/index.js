// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:DepositManager", "Deploy DepositManager contract", require("./depositManager.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("priceOracle", "The address of priceOracle contract")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("tierManager", "The address of the TiersManager contract")
  .addOptionalParam("magicTierCoefficient", "A coefficient by which to multiply if the msg.sender has the magic tier");

task("depositManager.setRewardParameters", "Set reward ", require("./depositManager.setRewardParameters.js"));
