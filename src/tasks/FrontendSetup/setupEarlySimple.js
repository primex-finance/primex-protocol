// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const fs = require("fs");

module.exports = async function (
  { _ },
  {
    ethers: {
      BigNumber,
      getContract,
      constants: { HashZero },
      utils: { parseEther },
    },
  },
) {
  const bucketsConfig = getConfigByName("EarlyRewards.json");
  const output = {};
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { Role } = require("../../test/utils/activityRewardDistributorMath.js");
  const mediumTimelockAdmin = await getContract("MediumTimelockAdmin");
  const activityRewardDistributor = await getContract("ActivityRewardDistributor");
  const EPMXToken = await getContract("EPMXToken");
  const delay = (await mediumTimelockAdmin.getMinDelay()).toString();

  for (const bucket in bucketsConfig) {
    const bucketAddress = (await getContract(bucket)).address;
    const targets = [];
    const payloads = [];
    const setupEncodeTargets = [];
    const setupEncodePayloads = [];
    let allAmount = BigNumber.from(0);

    for (const role in bucketsConfig[bucket]) {
      const settings = bucketsConfig[bucket][role];
      const bucketAmount = parseEther(settings.amount.toString());
      allAmount = allAmount.add(bucketAmount);

      const setupEncode = await encodeFunctionData(
        "setupBucket",
        [bucketAddress, Role[role], bucketAmount, parseEther(settings.rewardPerDay.toString())],
        "ActivityRewardDistributor",
      );
      setupEncodeTargets.push(setupEncode.contractAddress);
      setupEncodePayloads.push(setupEncode.payload);
    }
    let encodeResult = await encodeFunctionData(
      "transferFromTreasury",
      [allAmount, EPMXToken.address, mediumTimelockAdmin.address],
      "Treasury",
    );
    targets.push(encodeResult.contractAddress);
    payloads.push(encodeResult.payload);

    encodeResult = await encodeFunctionData("approve", [activityRewardDistributor.address, allAmount], "EPMXToken");
    targets.push(encodeResult.contractAddress);
    payloads.push(encodeResult.payload);

    const values = new Array(targets.length + setupEncodeTargets.length).fill(0);
    output[bucket] = [targets.concat(setupEncodeTargets), values, payloads.concat(setupEncodePayloads), HashZero, HashZero, delay];
  }

  fs.writeFileSync("./earlySetupData.json", JSON.stringify(output, null, 2));
  console.log("See data for timelocks are in 'earlySetup.json'");
};
