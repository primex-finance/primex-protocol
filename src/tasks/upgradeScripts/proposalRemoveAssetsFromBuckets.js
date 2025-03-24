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
  const { getConfig } = require("../../config/configUtils.js");
  const { assets } = getConfig();
  const chainId = (await provider.getNetwork()).chainId;

  // Add the addresses of existing buckets where you want to remove assets
  const bucketAddresses = ["0x6956BdfF17C68D3B37faF1415769De316682EDBb", "0x0bF4003de65eCeA86026c6Cdcc80eb6Bfa15A3A7"];

  // Add assets which will be removed from buckets and their addresses will be taken from config file addresses.json
  const assetsToRemove = ["wbtc", "wmatic"];

  // immutable
  const SmallTimeLock = await getContract("SmallTimelockAdmin");

  const smallDelay = await SmallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;

  const output = {};
  for (const assetName of assetsToRemove) {
    if (!(assetName in assets)) {
      console.log(`Asset ${assetName} not found in addresses.json. Skipping...`);
      continue;
    }
    if (!output[assetName]) {
      output[assetName] = {};
    }

    const assetAddress = assets[assetName];
    const targets = [];
    const payloads = [];

    for (const bucketAddress of bucketAddresses) {
      const Bucket = await getContractAt("Bucket", bucketAddress);
      const encodeResult = await encodeFunctionData("removeAsset", [assetAddress], "Bucket", Bucket.address);
      targets.push(encodeResult.contractAddress);
      payloads.push(encodeResult.payload);
    }
    console.log(`Proposal created for ${assetName}`);
    output[assetName] = [targets, Array(targets.length).fill(0), payloads, predecessor, salt, smallDelay.toString()];
  }

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "RemoveAssetsFromBuckets");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });

  fs.writeFileSync(path.join(directoryPath, "RemoveAssetsFromBuckets_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleBatchData(output);
  const executeBatchData = await prepareExecuteBatchData(output);

  fs.writeFileSync(path.join(directoryPath, "RemoveAssetsFromBuckets_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "RemoveAssetsFromBuckets_execute.json"), JSON.stringify(executeBatchData, null, 2));

  async function prepareScheduleBatchData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Multiple Batch Schedule Transaction",
        description: "Multiple SmallTimelockAdmin.scheduleBatch to remove assets from buckets",
      },
      transactions: [],
    };
    for (const asset in output) {
      const data = output[asset];
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

  async function prepareExecuteBatchData(output) {
    const executeData = {
      chainId: chainId,
      meta: {
        name: "Multiple Batch Execute Transaction",
        description: "Multiple SmallTimelockAdmin.executeBatch to remove assets from buckets",
      },
      transactions: [],
    };
    for (const asset in output) {
      const data = output[asset];
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
