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

  const amounts = {
    polygon: {
      amount: "877788702965617170279191"
    },
    arbitrumOne: {
      amount: "988300000000000000000000"
    },
    ethereum: {
      amount: "1000000000000000000000000"
    }
  };

  const encodeResult = await encodeFunctionData("withdrawPmx", [amounts[network.name].amount], "SpotTradingRewardDistributor");
  output.targets = encodeResult.contractAddress;
  output.payloads = encodeResult.payload;
  output.values = "0";


  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "WithdrawPmx");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "WithdrawPmxSpot_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output);
  const executeData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "WithdrawPmxSpot_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "WithdrawPmxSpot_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Schedule Transaction",
        description: "Single bigTimeLockAdmin.schedule to withdraw ePMX from spotTradingRewardDistribuor",
      },
      transactions: [],
    };

    const encodeResult = await encodeFunctionData(
      "schedule",
      [output.targets, output.values, output.payloads, predecessor, salt, bigDelay],
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
        description: "bigTimeLockAdmin.execute to withdraw ePMX from spotTradingRewardDistribuor",
      },
      transactions: [],
    };

    const encodeResult = await encodeFunctionData(
      "execute",
      [output.targets, output.values, output.payloads, predecessor, salt],
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
