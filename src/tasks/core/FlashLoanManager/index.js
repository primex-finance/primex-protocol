// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:FlashLoanManager", "Deploy PositionManager contract", require("./flashLoanManager.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addParam("flashLoanFeeRate", "Percent that is paid by the borrower")
  .addParam("flashLoanProtocolRate", "Percent of the fee paid by the borrower that goes to the Treasury")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addFlag("notExecuteNewDeployedTasks", "Whether to ignore the newDeployed if statement");
