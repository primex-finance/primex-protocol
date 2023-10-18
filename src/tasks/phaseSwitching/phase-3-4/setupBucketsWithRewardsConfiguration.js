// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ totalReward, rewardPerDay, role, delay, isExecute }, { ethers: { getContract } }) {
  const { getPhase34ArgumentsSetupBuckets } = require("./getPhaseArguments.js");

  const timelock = await getContract("MediumTimelockAdmin");

  if (role !== "LENDER" && role !== "TRADER") throw new Error("Incorrect role");
  if (!delay) {
    delay = await timelock.getMinDelay();
  }

  const args = await getPhase34ArgumentsSetupBuckets(totalReward, rewardPerDay, role);
  if (isExecute) {
    const tx = await timelock.executeBatch(...args);
    await tx.wait();
    console.log("ActivityRewardDistributor: setupBucket executed");
  } else {
    args.push(delay);
    const tx = await timelock.scheduleBatch(...args);
    await tx.wait();
    console.log(`ActivityRewardDistributor: setupBucket scheduled in ${delay}s`);
  }
};
