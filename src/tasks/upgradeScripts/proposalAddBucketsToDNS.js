// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const path = require("path");
module.exports = async function (
  { __ },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      utils: { keccak256, toUtf8Bytes },
      constants: { HashZero },
      provider,
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
  const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));

  const chainId = (await provider.getNetwork()).chainId;
  // immutable
  const smallTimeLock = await getContract("SmallTimelockAdmin");
  const whiteBlackList = (await getContract("WhiteBlackList")).address;
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const primexDNS = PrimexDNS.address;
  const registry = (await getContract("Registry")).address;
  const treasury = (await getContract("Treasury")).address;
  const pmx = (await getContract("EPMXToken")).address;

  const smallDelay = await smallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForSmallTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };
  const output = {};

  // Add bucket addresses which to add to DNS
  const bucketAddresses = [
    "0x6956BdfF17C68D3B37faF1415769De316682EDBb",
    "0x0bF4003de65eCeA86026c6Cdcc80eb6Bfa15A3A7",
    "0xAa5f11e1C14F9a73467Bf79972585c5df1842104",
    "0xFD69831f0bbc4EF20A5cf493Ba8AAcB924A7CDFC",
  ];

  for (let i = 0; i < bucketAddresses.length; i++) {
    const bucketAddress = bucketAddresses[i];
    const pmxRewardAmount = 0;
    const needPMX = false;
    const needApprove = false;
    const Bucket = await getContractAt("Bucket", bucketAddress);

    const pToken = await Bucket.pToken();
    const debtToken = await Bucket.debtToken();

    console.log("Bucket Name:", await Bucket.name());
    console.log("Bucket Address:", bucketAddress);
    console.log("PMX Reward Amount:", pmxRewardAmount);
    console.log("Need PMX:", needPMX);
    console.log("Need Approve:", needApprove);
    console.log("---------------------------");

    // Add Bucket, PToken and DebtToken to Whitelist
    argsForSmallTimeLock.targets.push(whiteBlackList);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("addAddressesToWhitelist", [[bucketAddress, pToken, debtToken]], "WhiteBlackList", whiteBlackList)).payload,
    );
    if (needPMX) {
      // Transfer pmx to smallTimelockAdmin
      argsForSmallTimeLock.targets.push(treasury);
      argsForSmallTimeLock.payloads.push(
        (await encodeFunctionData("transferFromTreasury", [pmxRewardAmount, pmx, smallTimeLock.address], "Treasury", treasury)).payload,
      );
    }

    if (needApprove) {
      argsForSmallTimeLock.targets.push(pmx);
      argsForSmallTimeLock.payloads.push((await encodeFunctionData("approve", [primexDNS, pmxRewardAmount], "EPMXToken", pmx)).payload);
    }

    // Add Bucket in primexDNS
    argsForSmallTimeLock.targets.push(primexDNS);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("addBucket", [bucketAddress, pmxRewardAmount], "PrimexDNS", primexDNS)).payload,
    );

    // Grant NO_FEE_ROLE for Bucket
    argsForSmallTimeLock.targets.push(registry);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [NO_FEE_ROLE, bucketAddress], "PrimexRegistry", registry)).payload,
    );

    // Grant VAULT_ACCESS_ROLE for Bucket
    argsForSmallTimeLock.targets.push(registry);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, bucketAddress], "PrimexRegistry", registry)).payload,
    );

    output[await Bucket.name()] = [
      argsForSmallTimeLock.targets,
      Array(argsForSmallTimeLock.targets.length).fill(0),
      argsForSmallTimeLock.payloads,
      predecessor,
      salt,
      smallDelay.toString(),
    ];

    argsForSmallTimeLock.targets = [];
    argsForSmallTimeLock.payloads = [];
  }

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "AddBucketsToDNS");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "AddBucketsToDNS_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output);
  const executeData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "AddBucketsToDNS_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "AddBucketsToDNS_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Multiple Batch Schedule Transaction",
        description: "Multiple SmallTimelockAdmin.scheduleBatch to add all buckets to DNS from the list",
      },
      transactions: [],
    };
    for (const bucket in output) {
      const data = output[bucket];
      const [targets, values, payloads] = data;

      const encodeResult = await encodeFunctionData(
        "scheduleBatch",
        [targets, values, payloads, predecessor, salt, smallDelay],
        "SmallTimelockAdmin",
      );

      scheduleData.transactions.push({
        to: encodeResult.contractAddress,
        value: "0",
        data: encodeResult.payload,
        contractMethod: null,
        contractInputsValues: null,
      });
    }

    return scheduleData;
  }

  async function prepareExecuteData(output) {
    const executeData = {
      chainId: chainId,
      meta: {
        name: "Multiple Batch Execute Transaction",
        description: "Multiple SmallTimelockAdmin.executeBatch to add all buckets to DNS from the list",
      },
      transactions: [],
    };
    for (const bucket in output) {
      const data = output[bucket];
      const [targets, values, payloads] = data;

      const encodeResult = await encodeFunctionData("executeBatch", [targets, values, payloads, predecessor, salt], "SmallTimelockAdmin");

      executeData.transactions.push({
        to: encodeResult.contractAddress,
        value: "0",
        data: encodeResult.payload,
        contractMethod: null,
        contractInputsValues: null,
      });
    }

    return executeData;
  }
};
