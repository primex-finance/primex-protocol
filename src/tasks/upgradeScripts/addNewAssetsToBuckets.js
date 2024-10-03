// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { __ },
  {
    ethers: {
      getContract,
      getContractAt,
      constants: { HashZero },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfig } = require("../../config/configUtils.js");
  const { assets } = getConfig();
  // This script creates a proposals for each of the assets listed in the `assetsToAdd` to all buckets that exist in bucketAddresses
  // Please add the addresses of existing buckets where you want to add the new asset
  const bucketAddresses = ["0x4a95f6c8959E6813aD7c44468ae6df959B588Bc2", "0x2BD787434c527C13Dc633557b7Bc40247F8e50f7"];

  // Add actual assets which will be added to buckets and their addresses will be taken from config file addresses.json
  const assetsToAdd = ["usdt", "uni", "usdc"];

  // immutable
  const MediumTimeLock = await getContract("MediumTimelockAdmin");

  const mediumDelay = await MediumTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForMediumTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  for (const assetName of assetsToAdd) {
    if (!(assetName in assets)) {
      console.log(`Asset ${assetName} not found in addresses.json. Skipping...`);
      continue;
    }

    const assetAddress = assets[assetName];
    argsForMediumTimeLock.targets = [];
    argsForMediumTimeLock.payloads = [];

    for (const bucketAddress of bucketAddresses) {
      const Bucket = await getContractAt("Bucket", bucketAddress);
      argsForMediumTimeLock.targets.push(Bucket.address);
      argsForMediumTimeLock.payloads.push((await encodeFunctionData("addAsset", [assetAddress], "Bucket", Bucket.address)).payload);
    }
    const argsMedium = [
      argsForMediumTimeLock.targets,
      Array(argsForMediumTimeLock.targets.length).fill(0),
      argsForMediumTimeLock.payloads,
      predecessor,
      salt,
      mediumDelay.toString(),
    ];
    fs.writeFileSync(`./argsForMediumTimeLockToAddAsset-${assetName}.json`, JSON.stringify(argsMedium, null, 2));
    console.log(`Proposal file created for ${assetName}`);
  }
};
