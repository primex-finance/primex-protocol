// SPDX-License-Identifier: BUSL-1.1
const path = require("path");
const fs = require("fs");

module.exports = async function (
  { __ },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      constants: { HashZero },
      provider,
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const chainId = (await provider.getNetwork()).chainId;

  // Add the addresses of frozen buckets which you want to activate
  const bucketAddresses = ["0x6956BdfF17C68D3B37faF1415769De316682EDBb", "0x0bF4003de65eCeA86026c6Cdcc80eb6Bfa15A3A7"];
  // immutable
  const PrimexDNS = await getContract("PrimexDNS");
  const SmallTimeLock = await getContract("SmallTimelockAdmin");

  const smallDelay = await SmallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;

  const output = {};
  for (const bucketAddress of bucketAddresses) {
    const Bucket = await getContractAt("Bucket", bucketAddress);
    const bucketName = await Bucket.name();
    const encodeResult = await encodeFunctionData("activateBucket", [bucketName], "PrimexDNS", PrimexDNS.address);
    const value = 0;
    output[bucketName] = [encodeResult.contractAddress, value, encodeResult.payload, predecessor, salt, smallDelay.toString()];
    console.log(`Proposal created for ${bucketName}`);
  }

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "ActivateFrozenBucket");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });

  fs.writeFileSync(path.join(directoryPath, "ActivateFrozenBucket_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleData(output);
  const executeBatchData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "ActivateFrozenBucket_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "ActivateFrozenBucket_execute.json"), JSON.stringify(executeBatchData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Multiple Schedule Transaction",
        description: "Multiple SmallTimelockAdmin.schedule to activate frozen buckets",
      },
      transactions: [],
    };
    for (const bucketName in output) {
      const data = output[bucketName];
      const [target, value, payload] = data;

      const encodeResult = await encodeFunctionData(
        "schedule",
        [target, value, payload, predecessor, salt, smallDelay],
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
        name: "Multiple Execute Transaction",
        description: "Multiple SmallTimelockAdmin.execute to activate frozen buckets",
      },
      transactions: [],
    };
    for (const bucketName in output) {
      const data = output[bucketName];
      const [target, value, payload] = data;

      const encodeResult = await encodeFunctionData("execute", [target, value, payload, predecessor, salt], "SmallTimelockAdmin");

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
