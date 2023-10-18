// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ role, delay, isExecute }, { ethers: { getContract } }) {
  const { getPhase34ArgumentsSetEarlyRewardsInBuckets } = require("./getPhaseArguments.js");

  const timelock = await getContract("BigTimelockAdmin");

  if (role !== "LENDER" && role !== "TRADER") throw new Error("Incorrect role");
  if (!delay) {
    delay = await timelock.getMinDelay();
  }

  const args = await getPhase34ArgumentsSetEarlyRewardsInBuckets(role);
  if (isExecute) {
    const tx = await timelock.executeBatch(...args);
    await tx.wait();
  } else {
    args.push(delay);
    const tx = await timelock.scheduleBatch(...args);
    await tx.wait();
  }

  console.log("Early rewards have been set!");
};
