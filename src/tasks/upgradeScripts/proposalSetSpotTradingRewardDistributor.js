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
      constants: { HashZero },
      utils: { parseUnits },
      provider,
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const chainId = (await provider.getNetwork()).chainId;

  // immutable
  const bigTimeLock = await getContract("BigTimelockAdmin");

  const bigDelay = await bigTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const output = {
    targets: null,
    values: null,
    payloads: null,
    predecessor: predecessor,
    salt: salt,
    bigDelay: bigDelay.toString(),
  };

  const { payload } = await encodeFunctionData("setSpotTradingRewardDistributor", ["0x0000000000000000000000000000000000000000"], "PositionManagerExtension");

  const encodeResult = await encodeFunctionData("setProtocolParamsByAdmin", [payload], "PositionManager");
  output.targets = encodeResult.contractAddress;
  output.payloads = encodeResult.payload;
  output.values = "0";


  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "SetSpotTradingRewardDistribuor");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetSpotTradingRewardDistribuor_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output);
  const executeData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetSpotTradingRewardDistribuor_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetSpotTradingRewardDistribuor_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Schedule Transaction",
        description: "Single bigTimeLockAdmin.schedule to set spotTradingRewardDistribuor",
      },
      transactions: [],
    };

    const encodeResult = await encodeFunctionData(
      "schedule",
      [output.targets, output.values, output.payloads, output.predecessor, output.salt, output.bigDelay],
      "BigTimelockAdmin",
    );

    scheduleData.transactions.push({
      to: encodeResult.contractAddress,
      value: "0",
      data: encodeResult.payload,
      contractMethod: null,
      contractInputsValues: null,
    });

    return scheduleData;
  }

  async function prepareExecuteData(output) {
    const executeData = {
      chainId: chainId,
      meta: {
        name: "Execute Transaction",
        description: "bigTimeLockAdmin.execute to set spotTradingRewardDistribuor",
      },
      transactions: [],
    };

    const encodeResult = await encodeFunctionData(
      "execute",
      [output.targets, output.values, output.payloads, output.predecessor, output.salt],
      "BigTimelockAdmin",
    );

    executeData.transactions.push({
      to: encodeResult.contractAddress,
      value: "0",
      data: encodeResult.payload,
      contractMethod: null,
      contractInputsValues: null,
    });

    return executeData;
  }
};
