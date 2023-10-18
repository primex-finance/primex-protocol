// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ delay, isExecute }, { ethers: { getContract } }) {
  const { setSpotTradingRewardDistributrInPM } = require("./getPhaseArguments.js");

  const timelock = await getContract("BigTimelockAdmin");

  if (!delay) {
    delay = await timelock.getMinDelay();
  }
  const spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");

  const args = await setSpotTradingRewardDistributrInPM(spotTradingRewardDistributor.address);

  if (isExecute) {
    const tx = await timelock.execute(...args);
    await tx.wait();
  } else {
    args.push(delay);
    const tx = await timelock.schedule(...args);
    await tx.wait();
  }

  console.log("Early rewards have been set!");
};
