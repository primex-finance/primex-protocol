// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    utils: { parseEther },
    constants: { HashZero },
  },
} = require("hardhat");
const { encodeFunctionData } = require("../../utils/encodeFunctionData.js");

async function getPhase2Arguments(rewardPerPeriod) {
  const data = await encodeFunctionData("setRewardPerPeriod", [parseEther(rewardPerPeriod)], "SpotTradingRewardDistributor");
  return [data.contractAddress, 0, data.payload, HashZero, HashZero];
}

async function setSpotTradingRewardDistributrInPM(distributorAddress) {
  const data = await encodeFunctionData("setSpotTradingRewardDistributor", [distributorAddress], "PositionManager");
  return [data.contractAddress, 0, data.payload, HashZero, HashZero];
}

module.exports = { getPhase2Arguments, setSpotTradingRewardDistributrInPM };
