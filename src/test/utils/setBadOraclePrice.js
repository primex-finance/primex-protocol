// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    getContract,
    utils: { parseEther },
    BigNumber,
  },
} = require("hardhat");
const { wadMul, wadDiv } = require("./math");
const { WAD } = require("./constants");

const fivePercent = parseEther("0.05");

async function setBadOraclePrice(priceFeed, additionalPercentage, isForward, correctPrice = undefined, oracleTolerableLimit = undefined) {
  const positionManager = await getContract("PositionManager");
  oracleTolerableLimit = oracleTolerableLimit ?? (await positionManager.defaultOracleTolerableLimit());
  let limitPrice;
  if (correctPrice === undefined) {
    limitPrice = await priceFeed.latestAnswer();
  } else {
    limitPrice = correctPrice;
  }
  let badPrice;
  if (isForward) {
    badPrice = wadDiv(limitPrice.toString(), BigNumber.from(WAD).sub(oracleTolerableLimit.add(additionalPercentage)).toString()).toString();
  } else {
    badPrice = wadMul(limitPrice.toString(), BigNumber.from(WAD).sub(oracleTolerableLimit.add(additionalPercentage)).toString()).toString();
  }
  await priceFeed.setAnswer(badPrice);
}

module.exports = { setBadOraclePrice, fivePercent };
