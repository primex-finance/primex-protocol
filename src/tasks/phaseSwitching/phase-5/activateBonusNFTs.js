// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ delay, isExecute }, { ethers: { getContract } }) {
  const { getPhase5Arguments } = require("./getPhaseArguments.js");

  const timelock = await getContract("BigTimelockAdmin");

  if (!delay) {
    delay = await timelock.getMinDelay();
  }

  const args = await getPhase5Arguments();
  if (isExecute) {
    const tx = await timelock.executeBatch(...args);
    await tx.wait();
    console.log("PToken, DebtToken: setup NFT executed");
  } else {
    args.push(delay);
    const tx = await timelock.scheduleBatch(...args);
    await tx.wait();
    console.log(`PToken, DebtToken: setup NFT executed scheduled in ${delay}s`);
  }
};
