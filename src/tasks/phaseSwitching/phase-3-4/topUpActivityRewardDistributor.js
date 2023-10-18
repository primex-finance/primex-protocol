// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { pmxAmount },
  {
    ethers: {
      getContract,
      utils: { parseEther },
    },
  },
) {
  const timelock = await getContract("MediumTimelockAdmin");
  const pmx = await getContract(process.env.NEWPMX ? "PMXToken" : "EPMXToken");

  if (!pmxAmount) {
    throw new Error("pmxAmount is 0");
  }
  // send to timelock first. PMX will be transfered to activityRewardDistributor during setupBucket
  const txSend = await pmx.transfer(timelock.address, parseEther(pmxAmount));
  await txSend.wait();
};
