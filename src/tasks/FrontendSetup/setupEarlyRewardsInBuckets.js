// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { _ },
  {
    run,
    ethers: {
      getContract,
      getContractAt,
      utils: { parseEther },
    },
  },
) {
  const BucketsFactory = await getContract("BucketsFactoryV2");
  const activityRewardDistributor = await getContract("ActivityRewardDistributor");

  const buckets = await BucketsFactory.allBuckets();
  const totalReward = parseEther("2000");
  const rewardPerDay = parseEther("400");
  let tx;
  for (let i = 0; i < buckets.length; i++) {
    const bucket = await getContractAt("Bucket", buckets[i]);
    const PToken = await getContractAt("PToken", await bucket.pToken());
    const debtToken = await getContractAt("DebtToken", await bucket.debtToken());

    tx = await PToken.setLenderRewardDistributor(activityRewardDistributor.address);
    await tx.wait();
    tx = await debtToken.setTraderRewardDistributor(activityRewardDistributor.address);
    await tx.wait();

    await run("ActivityRewardDistributor:setupBucket", {
      bucket: buckets[i],
      increaseAmount: totalReward.mul(i + 1).toString(),
      rewardPerDay: rewardPerDay.mul(i + 2).toString(),
      role: "LENDER",
    });

    await run("ActivityRewardDistributor:setupBucket", {
      bucket: buckets[i],
      increaseAmount: totalReward.mul(i + 2).toString(),
      rewardPerDay: rewardPerDay.mul(i + 3).toString(),
      role: "TRADER",
    });
  }
  console.log("Early rewards have been set!");
};
