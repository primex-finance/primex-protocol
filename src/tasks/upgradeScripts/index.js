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
task("upgradePmx", "", require("./upgradePmx.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgrade", "", require("./upgrade-8-2.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("deployNewFactory", "", require("./deployNewFactory.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("addCurveToken", "", require("./addCurveToken.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeDepositManager", "", require("./upgradeDepositManager.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("changeThresholdForTier", "", require("./changeThresholdForTier.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("downgrade", "", require("./downgrade-8-2.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeSolcVersion", "", require("./upgradeSolcVersion.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed")
  .addFlag("isFork", "The flag to indicate whether chain is a fork");

task("proposalDepositManager", "", require("./proposalDepositManager.js"))
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed")
  .addFlag("isFork", "The flag to indicate whether chain is a fork");

task("proposalSetRewardParameters", "", require("./proposalSetRewardParameters.js"))
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed")
  .addFlag("isFork", "The flag to indicate whether chain is a fork");

task("upgradeTraderBalanceVault", "", require("./upgradeTraderBalanceVault.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("updateRates", "", require("./updateRates.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeBucketAndDexAdapter", "", require("./upgradeBucketAndDexAdapter.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("proposalsAddBucketsToDNS", "", require("./proposalAddBucketsToDNS.js"));

task("proposalUpdatePairPriceDrop", "", require("./proposalUpdatePairPriceDrop.js"));

task(
  "proposalAddNewAssetsToBuckets",
  "Creates a proposals for each of the assets listed in the `assetsToAdd` object to all buckets that exist in bucketAddresses",
  require("./proposalAddNewAssetsToBuckets.js"),
).addFlag(
  "bucketMode",
  "Create proposal for each bucket from the list with adding all the assets from the list, if false for each asset from the list with adding it to all the buckets from the list.",
);

task("proposalAddNewPriceFeeds", "", require("./proposalAddNewPriceFeeds.js"));

task("proposalAddNewPythPriceFeedIds", "", require("./proposalAddNewPythPriceFeedIds.js"));

task("proposalAddNewUniV3TrustedPairs", "", require("./proposalAddNewUniV3TrustedPairs.js"));

task("proposalSetupNewBuckets", "", require("./proposalSetupNewBuckets.js")).addParam("bucketsPerBatch", "Number of buckets per batch ");

task("proposalUpdateMaxPositionSize", "", require("./proposalUpdateMaxPositionSize.js"));

task("proposalSetOracleTolerance", "", require("./proposalSetOracleTolerance.js"));

task("proposalSetBarCalculationParams", "", require("./proposalSetBarCalculationParams.js"))
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed")
  .addFlag("isFork", "The flag to indicate whether chain is a fork");

task("proposalRemoveAssetsFromBuckets", "", require("./proposalRemoveAssetsFromBuckets.js"));

task("executeFromTimeLock", "", require("./executeFromTimeLock.js")).addFlag("isFork", "The flag to indicate whether chain is a fork");

task("mintPrimexNFT", "", require("./mintPrimexNFT.js"));

task("proposalActivateBuckets", "", require("./proposalActivateBuckets.js"));
task("addNewDexes", "", require("./addNewDexes.js"));

task("updatePairPriceDrop", "", require("./proposalUpdatePairPriceDrop.js"));
task(
  "addNewAssetsToBucket",
  "Creates a proposals for each of the assets listed in the `assetsToAdd` object to all buckets that exist in bucketAddresses",
  require("./proposalAddNewAssetsToBuckets.js"),
);

task("createProposalsAddBucketsToDNS", "", require("./proposalAddBucketsToDNS.js"));

task("upgradeLimitOrderManager", "", require("./upgradeLimitOrderManager.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("upgradeBatchManager", "", require("./upgradeBatchManager.js"))
  .addFlag("executeFromDeployer", "The flag to indicate whether to execute on behalf of the deployer")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("proposalSetSpotTradingRewardDistributor", "", require("./proposalSetSpotTradingRewardDistributor.js"));

task("proposalWithdrawEpmxFromSpotTradingRewardDistributor", "", require("./proposalWithdrawEpmxFromSpotTradingRewardDistributor.js"));

task("proposalSetActivityRewardDistributor", "", require("./proposalSetActivityRewardDistributor.js"));

task("proposalWithdrawEpmxFromLMRewardDitributor", "", require("./proposalWithdrawEpmxFromLMRewardDitributor.js"));

task("proposalWithdrawFromActivityRewardDistributor", "", require("./proposalWithdrawFromActivityRewardDistributor.js"));

task("proposalSetEnforcedOptionsLZ", "", require("./proposalSetEnforcedOptionsLZ.js"));

task("upgradeTierManager", "", require("./upgradeTierManager.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("deployCurveStableOracle", "", require("./deployCurveStableOracle.js"))
  .addFlag("isFork", "The flag to indicate whether chain is a fork")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");
