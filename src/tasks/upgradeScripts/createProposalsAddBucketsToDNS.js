// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { __ },
  {
    ethers: {
      getContract,
      getContractAt,
      utils: { keccak256, toUtf8Bytes },
      constants: { HashZero },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfigByName } = require("../../config/configUtils.js");
  const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
  const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));

  const bucketsConfig = getConfigByName("delayedBuckets.json");
  const bucketsData = [];

  bucketsConfig.buckets.forEach(bucket => {
    const bucketName = bucket.bucketName;
    const bucketAddress = bucket.flowConfig.step2Params.bucket;
    const pmxRewardAmount = bucket.LiquidityMining.pmxRewardAmount;
    const needPMX = bucket.flowConfig.step2Params.needPMX;
    const needApprove = bucket.flowConfig.step2Params.needApprove;

    bucketsData.push({
      name: bucketName,
      bucketAddress: bucketAddress,
      pmxRewardAmount: pmxRewardAmount,
      needPMX: needPMX,
      needApprove: needApprove,
    });
    console.log("Bucket Name:", bucketName);
    console.log("Bucket Address:", bucketAddress);
    console.log("PMX Reward Amount:", pmxRewardAmount);
    console.log("Need PMX:", needPMX);
    console.log("Need Approve:", needApprove);
    console.log("---------------------------");
  });

  // immutable
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const whiteBlackList = (await getContract("WhiteBlackList")).address;
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const primexDNS = PrimexDNS.address;
  const registry = (await getContract("Registry")).address;
  const treasury = (await getContract("Treasury")).address;
  const pmx = (await getContract("EPMXToken")).address;

  const BigDelay = await bigTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };
  const argsForBigTimeLockAddBucketsInDNS = {};

  for (let i = 0; i < bucketsData.length; i++) {
    const bucketData = bucketsData[i];
    const bucketAddress = bucketData.bucketAddress;
    const pmxRewardAmount = bucketData.pmxRewardAmount;
    const needPMX = bucketData.needPMX;
    const needApprove = bucketData.needApprove;
    const Bucket = await getContractAt("Bucket", bucketAddress);

    const pToken = await Bucket.pToken();
    const debtToken = await Bucket.debtToken();
    // Add Bucket, PToken and DebtToken to Whitelist
    argsForBigTimeLock.targets.push(whiteBlackList);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addAddressesToWhitelist", [[bucketAddress, pToken, debtToken]], "WhiteBlackList", whiteBlackList)).payload,
    );
    if (needPMX) {
      // Transfer pmx to bigTimelockAdmin
      argsForBigTimeLock.targets.push(treasury);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("transferFromTreasury", [pmxRewardAmount, pmx, bigTimeLock.address], "Treasury", treasury)).payload,
      );
    }

    if (needApprove) {
      argsForBigTimeLock.targets.push(pmx);
      argsForBigTimeLock.payloads.push((await encodeFunctionData("approve", [primexDNS, pmxRewardAmount], "EPMXToken", pmx)).payload);
    }

    // Add Bucket in primexDNS
    argsForBigTimeLock.targets.push(primexDNS);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addBucket", [bucketAddress, pmxRewardAmount], "PrimexDNS", primexDNS)).payload,
    );

    // Grant NO_FEE_ROLE for Bucket
    argsForBigTimeLock.targets.push(registry);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [NO_FEE_ROLE, bucketAddress], "PrimexRegistry", registry)).payload,
    );

    // Grant VAULT_ACCESS_ROLE for Bucket
    argsForBigTimeLock.targets.push(registry);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, bucketAddress], "PrimexRegistry", registry)).payload,
    );

    argsForBigTimeLockAddBucketsInDNS[bucketData.name] = [
      argsForBigTimeLock.targets,
      Array(argsForBigTimeLock.targets.length).fill(0),
      argsForBigTimeLock.payloads,
      predecessor,
      salt,
      BigDelay.toString(),
    ];

    argsForBigTimeLock.targets = [];
    argsForBigTimeLock.payloads = [];
  }

  fs.writeFileSync("./argsForBigTimeLockAddBucketsInDNS.json", JSON.stringify(argsForBigTimeLockAddBucketsInDNS, null, 2));
};
