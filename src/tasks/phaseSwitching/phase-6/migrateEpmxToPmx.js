// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ delay, isExecute }, { ethers: { getContract } }) {
  const { getPhase6ArgumentsSetPMX } = require("./getPhaseArguments");

  const timelock = await getContract("BigTimelockAdmin");

  if (!delay) {
    delay = await timelock.getMinDelay();
  }
  const args = await getPhase6ArgumentsSetPMX();
  if (isExecute) {
    const tx = await timelock.execute(...args);
    await tx.wait();
    console.log("Update ePMX to PMX executed");
  } else {
    args.push(delay);
    const tx = await timelock.schedule(...args);
    await tx.wait();
    console.log(`Update ePMX to PMX scheduled in ${delay}s`);
  }
};
