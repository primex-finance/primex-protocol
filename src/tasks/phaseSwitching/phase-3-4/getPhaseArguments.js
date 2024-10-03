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

async function getPhase34ArgumentsSetupBuckets(totalReward, rewardPerDay, role) {
  const targets = [];
  const payloads = [];
  const { Role } = require("../../../test/utils/activityRewardDistributorMath.js");
  const BucketsFactory = await getContract("BucketsFactoryV2");
  const buckets = await BucketsFactory.allBuckets();
  let encodeResult;

  const activityRewardDistributor = await getContract("ActivityRewardDistributor");
  // first, make approve for pmx tokens
  encodeResult = await encodeFunctionData("approve", [activityRewardDistributor.address, MaxUint256], "EPMXToken");

  targets.push(encodeResult.contractAddress);
  payloads.push(encodeResult.payload);

  for (let i = 0; i < buckets.length; i++) {
    encodeResult = await encodeFunctionData(
      "setupBucket",
      [buckets[i], Role[role], parseEther(totalReward), parseEther(rewardPerDay)],
      "ActivityRewardDistributor",
    );

    targets.push(encodeResult.contractAddress);
    payloads.push(encodeResult.payload);
  }
  const values = new Array(targets.length).fill(0);
  return [targets, values, payloads, HashZero, HashZero];
}

async function getPhase34ArgumentsSetEarlyRewardsInBuckets(role) {
  const targets = [];
  const payloads = [];
  const BucketsFactory = await getContract("BucketsFactoryV2");
  const buckets = await BucketsFactory.allBuckets();
  let encodeResult;

  const activityRewardDistributor = await getContract("ActivityRewardDistributor");

  for (let i = 0; i < buckets.length; i++) {
    const bucket = await getContractAt("Bucket", buckets[i]);

    if (role === "LENDER") {
      const pTokenAddress = await bucket.pToken();
      encodeResult = await encodeFunctionData("setLenderRewardDistributor", [activityRewardDistributor.address], "PToken", pTokenAddress);
      targets.push(pTokenAddress);
      payloads.push(encodeResult.payload);
    }

    if (role === "TRADER") {
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
  }
  const values = new Array(targets.length).fill(0);
  return [targets, values, payloads, HashZero, HashZero];
}

module.exports = { getPhase34ArgumentsSetupBuckets, getPhase34ArgumentsSetEarlyRewardsInBuckets };
