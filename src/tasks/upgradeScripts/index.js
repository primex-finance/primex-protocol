// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "checkUpdateScripts",
  "Script that first deploy the contract mocks and then checks if the upgrades are correct",
  require("./upgradeContracts"),
)
  .addFlag("deployContracts", "The flag to indicate whether new versions of contracts should be deployed")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("scheduleBatchContractUpgrade", "Schedule batch contract upgrade", require("./scheduleBatchContractUpgrade")).addParam(
  "params",
  "The array of contracts params to be upgraded",
);

task("upgrade", "", require("./upgrade-8-1.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeTraderBalanceVault", "", require("./upgradeTraderBalanceVault.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("updateRates", "", require("./updateRates.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeBucketAndDexAdapter", "", require("./upgradeBucketAndDexAdapter.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("addNewDexes", "", require("./addNewDexes.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("updatePairPriceDrop", "", require("./updatePairPriceDrop.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task(
  "addNewAssetsToBucket",
  "Creates a proposals for each of the assets listed in the `assetsToAdd` object to all buckets that exist in bucketAddresses",
  require("./addNewAssetsToBuckets.js"),
);

task("createProposalsAddBucketsToDNS", "", require("./createProposalsAddBucketsToDNS.js"));

task("upgradeLimitOrderManager", "", require("./upgradeLimitOrderManager.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeBatchManager", "", require("./upgradeBatchManager.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");
