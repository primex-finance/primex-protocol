// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");
// Step 1
// deploy bucket
// Step 2
// Add bucket in dns. Give bucket role. Add bucket and its tokens to whitelist

// if execute is true, then deploy and setup bucket by deployer(need access rights for this)
// if execute is false script return encoded params of needed transactions for timelocks
const flowConfig = {
  execute: true,
  steps: {
    1: true,
    2: true,
  },
  step2Params: {
    needPMX: undefined,
    needApprove: undefined,
    bucket: undefined,
    PToken: undefined,
    DebtToken: undefined,
  },
};

task("deploy:Bucket", "Deploy Bucket contract", require("./bucket.deploy"))
  // params to configure
  .addOptionalParam("primexDNS", "The address of the PrimexDNS contract")
  .addOptionalParam("bucketsFactoryV2", "The address of the BucketsFactoryV2 contract")
  .addOptionalParam("bigTimelockAdmin", "The address of the BigTimelockAdmin contract")
  .addOptionalParam("treasury", "The address of the Treasury contract")
  .addOptionalParam("registry", "The address of the Registry contract")
  .addOptionalParam("activityRewardDistributor", "The address of the ActivityRewardDistributor contract")
  .addParam("flowConfig", "See description of flowConfig in top of src/tasks/core/Bucket/index.js", JSON.stringify(flowConfig))

  // Bucket params
  .addParam("nameBucket", "bucket domain name")
  .addOptionalParam("positionManager", "The address of the PositionManager contract")
  .addOptionalParam("priceOracle", "The address of the PriceOracle contract")
  .addOptionalParam("reserve", "address of Reserve where a protocol fee is collected")
  .addOptionalParam("whiteBlackList", "The address of the WhiteBlackList contract")
  .addParam("assets", "list of assets for which the borrowed token can be exchanged in package")
  .addParam("feeBuffer", "bucket feeBuffer")
  .addParam("withdrawalFeeRate", "bucket withdrawalFeeRate")
  .addParam("reserveRate", "bucket reserveRate")
  .addOptionalParam("interestRateStrategy", "bucket interestRateStrategy")
  .addParam("estimatedBar", "bucket estimated borrowing annual rate, expressed in ray")
  .addParam("estimatedLar", "bucket estimated lending annual rate, expressed in ray")

  // PToken params
  .addParam("underlyingAsset", "The address of the underlying ERC20 token")

  // liquidity mining params
  // see description of these params in IBucket.sol
  .addOptionalParam("liquidityMiningRewardDistributor", "bucket liquidityMiningRewardDistributor")
  .addParam("liquidityMiningAmount", "bucket liquidityMiningAmount")
  .addOptionalParam("liquidityMiningDeadline", "bucket liquidityMiningDeadline")
  .addOptionalParam("stabilizationDuration", "bucket stabilizationDuration")
  .addOptionalParam("maxAmountPerUser", "The maximum amount that user can deposit during the liquidity mining phase")
  .addOptionalParam("pmx", "The address of PMXToken")
  .addOptionalParam("pmxRewardAmount", "The amount of PMXToken rewards in this bucket")
  .addFlag("isReinvestToAaveEnabled", "flag that turns on depositing to aave")

  // bar calculation params
  .addParam("barCalcParams", "barCalcParams is object with fields urOptimal, k0, k1, b0, b1 ")
  .addParam("maxTotalDeposit", "The max amount of total deposit for the bucket");
