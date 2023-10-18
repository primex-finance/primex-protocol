// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ delay, isExecute }, { ethers: { getContract } }) {
  const { getPhase6ArgumentsUpdateRewardConfigurationsInBuckets } = require("./getPhaseArguments");
  const timelock = await getContract("MediumTimelockAdmin");

  if (!delay) {
    delay = await timelock.getMinDelay();
  }

  const args = await getPhase6ArgumentsUpdateRewardConfigurationsInBuckets();
  if (isExecute) {
    const tx = await timelock.executeBatch(...args);
    await tx.wait();
  } else {
    args.push(delay);
    const tx = await timelock.scheduleBatch(...args);
    await tx.wait();
  }
};
