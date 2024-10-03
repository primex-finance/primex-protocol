// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    getContract,
    getContractAt,
    constants: { HashZero },
  },
} = require("hardhat");
const { encodeFunctionData } = require("../../utils/encodeFunctionData.js");

async function getPhase5Arguments() {
  const targets = [];
  const payloads = [];
  const BucketsFactory = await getContract("BucketsFactoryV2");
  const buckets = await BucketsFactory.allBuckets();
  const FeeDecreaser = await getContract("FeeDecreaser");
  const InterestIncreaser = await getContract("InterestIncreaser");

  let encodeResult;
  for (let i = 0; i < buckets.length; i++) {
    const bucket = await getContractAt("Bucket", buckets[i]);
    const pTokenAddress = await bucket.pToken();
    encodeResult = await encodeFunctionData("setInterestIncreaser", [InterestIncreaser.address], "PToken", pTokenAddress);
    targets.push(pTokenAddress);
    payloads.push(encodeResult.payload);

    const debtTokenAddress = await bucket.debtToken();
    encodeResult = await encodeFunctionData("setFeeDecreaser", [FeeDecreaser.address], "DebtToken", debtTokenAddress);
    targets.push(debtTokenAddress);
    payloads.push(encodeResult.payload);
  }
  const values = new Array(targets.length).fill(0);
  return [targets, values, payloads, HashZero, HashZero];
}

module.exports = { getPhase5Arguments };
