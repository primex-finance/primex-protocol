// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { lenderRewardDistributor, bucket, increaseAmount, rewardPerDay, role },
  {
    ethers: {
      getContract,
      getContractAt,
      utils: { formatEther },
    },
  },
) {
  const { Role } = require("../../../test/utils/activityRewardDistributorMath");
  if (!lenderRewardDistributor) {
    lenderRewardDistributor = (await getContract("ActivityRewardDistributor")).address;
  }
  lenderRewardDistributor = await getContractAt("ActivityRewardDistributor", lenderRewardDistributor);
  const pmx = await getContractAt("ERC20", await lenderRewardDistributor.pmx());
  const txApprove = await pmx.approve(lenderRewardDistributor.address, increaseAmount);
  await txApprove.wait();
  const tx = await lenderRewardDistributor.setupBucket(bucket, Role[role], increaseAmount, rewardPerDay);
  await tx.wait();
  console.log(
    `Bucket(${bucket}) ${role} was setuped with increaseAmount is ${formatEther(increaseAmount)} and rewardPerDay is ${formatEther(
      rewardPerDay,
    )}`,
  );
};
