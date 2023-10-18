// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    getContract,
    getContractAt,
    utils: { parseEther },
    constants: { MaxUint256, HashZero },
  },
} = require("hardhat");
const { encodeFunctionData } = require("../../utils/encodeFunctionData.js");

async function getPhase6ArgumentsSetPMX() {
  const PMX = await getContract("PMXToken");
  const encodeResult = await encodeFunctionData("setPMX", [PMX.address], "PrimexDNS");
  return [encodeResult.contractAddress, 0, encodeResult.payload, HashZero, HashZero];
}
async function getPhase6ArgumentsUpdateRewardConfigurationsInBuckets() {
  const targets = [];
  const payloads = [];
  const { Role } = require("../../../test/utils/activityRewardDistributorMath.js");
  const { earlyLendersRewards, earlyTradersRewards } = require("../../deployScripts/phaseSwitching/config.json");
  const BucketsFactory = await getContract("BucketsFactory");
  const buckets = await BucketsFactory.allBuckets();
  const activityRewardDistributor = await getContract("ActivityRewardDistributorNewPmx");
  let encodeResult;

  // first, make approve for pmx tokens
  encodeResult = await encodeFunctionData("approve", [activityRewardDistributor.address, MaxUint256], "PMXToken");
  targets.push(encodeResult.contractAddress);
  payloads.push(encodeResult.payload);

  for (let i = 0; i < buckets.length; i++) {
    encodeResult = await encodeFunctionData(
      "setupBucket",
      [buckets[i], Role.LENDER, parseEther(earlyLendersRewards.totalReward), parseEther(earlyLendersRewards.rewardPerDay)],
      "ActivityRewardDistributorNewPmx",
    );

    targets.push(encodeResult.contractAddress);
    payloads.push(encodeResult.payload);

    encodeResult = await encodeFunctionData(
      "setupBucket",
      [buckets[i], Role.TRADER, parseEther(earlyTradersRewards.totalReward), parseEther(earlyTradersRewards.rewardPerDay)],
      "ActivityRewardDistributorNewPmx",
    );

    targets.push(encodeResult.contractAddress);
    payloads.push(encodeResult.payload);
  }
  const values = new Array(targets.length).fill(0);
  return [targets, values, payloads, HashZero, HashZero];
}

async function getPhase6ArgumentsUpdateRewards() {
  const targets = [];
  const payloads = [];
  const BucketsFactory = await getContract("BucketsFactory");
  const buckets = await BucketsFactory.allBuckets();
  const activityRewardDistributor = await getContract("ActivityRewardDistributorNewPmx");
  const spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributorNewPmx");
  const keeperRewardDistributor = await getContract("KeeperRewardDistributorNewPmx");
  let encodeResult;

  encodeResult = await encodeFunctionData("setSpotTradingRewardDistributor", [spotTradingRewardDistributor.address], "PositionManager");
  targets.push(encodeResult.contractAddress);
  payloads.push(encodeResult.payload);

  encodeResult = await encodeFunctionData("setKeeperRewardDistributor", [keeperRewardDistributor.address], "PositionManager");
  targets.push(encodeResult.contractAddress);
  payloads.push(encodeResult.payload);

  for (let i = 0; i < buckets.length; i++) {
    const bucket = await getContractAt("Bucket", buckets[i]);
    const pTokenAddress = await bucket.pToken();
    encodeResult = await encodeFunctionData("setLenderRewardDistributor", [activityRewardDistributor.address], "PToken", pTokenAddress);
    targets.push(pTokenAddress);
    payloads.push(encodeResult.payload);

    const debtTokenAddress = await bucket.debtToken();
    encodeResult = await encodeFunctionData(
      "setTraderRewardDistributor",
      [activityRewardDistributor.address],
      "DebtToken",
      debtTokenAddress,
    );
    targets.push(debtTokenAddress);
    payloads.push(encodeResult.payload);
  }
  const values = new Array(targets.length).fill(0);
  return [targets, values, payloads, HashZero, HashZero];
}

module.exports = { getPhase6ArgumentsSetPMX, getPhase6ArgumentsUpdateRewardConfigurationsInBuckets, getPhase6ArgumentsUpdateRewards };
