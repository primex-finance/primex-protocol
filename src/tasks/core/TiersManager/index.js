// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:TiersManager", "Deploy PositionManager contract", require("./tiersManager.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("traderBalanceVault", "The address of TraderBalanceVault contract")
  .addParam("lendingNFT", "The address of the Lending NFT")
  .addParam("tradingNFT", "The address of the Trading NFT")
  .addParam("farmingNFT", "The address of the Farming NFT")
  .addParam("earlyPmx", "The address of the EPMX token contract")
  .addParam("tiers", "An array of tiers")
  .addParam("thresholds", "An array of thresholds to the tiers")
  .addFlag("notExecuteNewDeployedTasks", "Whether to ignore the newDeployed if statement");
