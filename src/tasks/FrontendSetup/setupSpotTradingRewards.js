// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");

module.exports = async function (
  { _ },
  {
    ethers: {
      getContract,
      utils: { parseEther, formatEther },
    },
  },
) {
  const positionManager = await getContract("PositionManager");
  const pmx = await getContract("EPMXToken");

  const spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
  if ((await positionManager.spotTradingRewardDistributor()) !== spotTradingRewardDistributor.address) {
    const tx = await positionManager.setSpotTradingRewardDistributor(spotTradingRewardDistributor.address);
    await tx.wait();
  }

  const { SpotTradingRD } = getConfigByName("generalConfig.json");
  const rewardPerPeriod = parseEther(SpotTradingRD.rewardPerPeriod);
  const increaseAmount = parseEther(SpotTradingRD.increaseAmount);

  let tx = await spotTradingRewardDistributor.setRewardPerPeriod(rewardPerPeriod);
  await tx.wait();
  console.log(`SpotTradingRewardDistributor: reward per period is ${formatEther(rewardPerPeriod)} PMX`);

  tx = await pmx.approve(spotTradingRewardDistributor.address, increaseAmount);
  await tx.wait();

  tx = await spotTradingRewardDistributor.topUpUndistributedPmxBalance(increaseAmount);
  await tx.wait();
  console.log(`SpotTradingRewardDistributor: added ${formatEther(increaseAmount)} to the available PMX balance.`);

  const undistributedPmxBalance = await spotTradingRewardDistributor.undistributedPMX();
  console.log(`SpotTradingRewardDistributor: available PMX balance is ${formatEther(undistributedPmxBalance)}.`);
};
