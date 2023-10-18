const { BigNumber } = require("ethers");
const { WAD } = require("../utils/constants");

const SECONDS_PER_DAY = 24 * 60 * 60;
const Role = Object.freeze({
  LENDER: 0,
  TRADER: 1,
});
function calculateRewardPerToken(rewardPerDay, scaledTotalSupplyInWAD) {
  return scaledTotalSupplyInWAD.toString() === "0"
    ? BigNumber.from(0)
    : BigNumber.from(rewardPerDay.div(SECONDS_PER_DAY).mul(WAD).div(scaledTotalSupplyInWAD).toString());
}

function calculateRewardIndex(currentTimestamp, currentBucketData) {
  currentTimestamp = currentBucketData.endTimestamp.gt(currentTimestamp) ? currentTimestamp : currentBucketData.endTimestamp;
  return currentBucketData.rewardIndex.add(currentBucketData.rewardPerToken.mul(currentTimestamp - currentBucketData.lastUpdatedTimestamp));
}

function calculateFixedReward(oldBalance, rewardIndex, currentTraderInfo) {
  return currentTraderInfo.fixedReward.add(oldBalance.mul(rewardIndex.sub(currentTraderInfo.lastUpdatedRewardIndex)).div(WAD));
}

function calculateEndTimestamp(currentTimestamp, totalReward, rewardPerDay, fixedReward = BigNumber.from(0)) {
  return totalReward.sub(fixedReward).mul(SECONDS_PER_DAY).div(rewardPerDay).add(currentTimestamp);
}
module.exports = { calculateFixedReward, calculateRewardIndex, calculateRewardPerToken, calculateEndTimestamp, SECONDS_PER_DAY, Role };
