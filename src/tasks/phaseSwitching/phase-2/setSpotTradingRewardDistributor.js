// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ rewardPerPeriod, delay, isExecute }, { ethers: { getContract } }) {
  const { getPhase2Arguments } = require("./getPhaseArguments.js");
  const timelock = await getContract("MediumTimelockAdmin");
  if (!delay) {
    delay = await timelock.getMinDelay();
  }

  const args = await getPhase2Arguments(rewardPerPeriod);

  if (isExecute) {
    const tx = await timelock.execute(...args);
    await tx.wait();
    console.log("SpotTradingRewardDistributor: setRewardPerPeriod executed");
  } else {
    args.push(delay);
    const tx = await timelock.schedule(...args);
    await tx.wait();
    console.log(`SpotTradingRewardDistributor: setRewardPerPeriod scheduled in ${delay}s`);
  }
};
