// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:TraderBalanceVault", "Deploy TraderBalanceVault contract", require("./traderBalanceVault.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
