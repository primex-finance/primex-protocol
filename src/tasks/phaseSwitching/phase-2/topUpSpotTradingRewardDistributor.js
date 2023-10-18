// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { pmxAmount },
  {
    ethers: {
      getContract,
      utils: { parseEther, formatEther },
    },
  },
) {
  const spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
  const pmx = await getContract("EPMXToken");

  if (!pmxAmount) {
    throw new Error("pmxAmount is 0");
  }
  const txApprove = await pmx.approve(spotTradingRewardDistributor.address, parseEther(pmxAmount));
  await txApprove.wait();

  const txTopUpPmx = await spotTradingRewardDistributor.topUpUndistributedPmxBalance(parseEther(pmxAmount));
  await txTopUpPmx.wait();
  console.log(`SpotTradingRewardDistributor: added ${pmxAmount} to the available PMX balance.`);
  const undistributedPmxBalance = await spotTradingRewardDistributor.undistributedPMX();
  console.log(`SpotTradingRewardDistributor: available PMX balance is ${formatEther(undistributedPmxBalance)}.`);
};
