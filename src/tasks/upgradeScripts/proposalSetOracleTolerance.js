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
      utils: { parseEther },
      provider,
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfigByName, getConfig } = require("../../config/configUtils.js");
  const pairsConfig = getConfigByName("pairsConfig.json");
  const { assets } = getConfig();
  const chainId = (await provider.getNetwork()).chainId;

  // immutable
  const smallTimeLock = await getContract("SmallTimelockAdmin");

  const tokensToInclude = [];
  const tokensToExclude = ["pepe", "spell"];

  const smallDelay = await smallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForSmallTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  for (const pair in pairsConfig) {
    const tokens = pair.split("-");
    if (tokensToInclude.length !== 0) {
      // set price drop only if at least one of the tokens belongs to the list
      if (!tokensToInclude.includes(tokens[0]) && !tokensToInclude.includes(tokens[1])) {
        continue;
      }
    }

    if (tokensToExclude.length !== 0) {
      // set price drop only if none of the tokens belongs to the list
      if (tokensToExclude.includes(tokens[0]) || tokensToExclude.includes(tokens[1])) {
        continue;
      }
    }

    const pairContracts = await Promise.all(
      tokens.map(async asset => {
        try {
          return await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", assets[asset]);
        } catch {
          console.log(`\n!!!WARNING: Address not found for token: ${asset} \n`);
          return null;
        }
      }),
    );

    if (pairContracts.some(contract => contract === null)) {
      continue;
    }

    // Set oracleTolerableLimit
    if (pairsConfig[pair].oracleTolerableLimit !== "0") {
      const oracleTolerableLimit = parseEther(pairsConfig[pair].oracleTolerableLimit);

      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [pairContracts[0].address, pairContracts[1].address, oracleTolerableLimit],
        "PositionManagerExtension",
      );
      const encodeResult = await encodeFunctionData("setProtocolParamsByAdmin", [payload], "PositionManager");

      argsForSmallTimeLock.targets.push(encodeResult.contractAddress);
      argsForSmallTimeLock.payloads.push(encodeResult.payload);
    }
  }

  const output = [
    argsForSmallTimeLock.targets,
    Array(argsForSmallTimeLock.targets.length).fill(0),
    argsForSmallTimeLock.payloads,
    predecessor,
    salt,
    smallDelay.toString(),
  ];

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "SetOracleTolerance");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetOracleTolerance_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleData(output);
  const executeBatchData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetOracleTolerance_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetOracleTolerance_execute.json"), JSON.stringify(executeBatchData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Single Batch Schedule Transaction",
        description: "Single SmallTimelockAdmin.scheduleBatch to set oracle tolerance",
      },
      transactions: [],
    };
    const [target, value, payload, predecessor, salt, delay] = output;
    const encodeResult = await encodeFunctionData(
      "scheduleBatch",
      [target, value, payload, predecessor, salt, delay],
      "SmallTimelockAdmin",
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
        name: "Single Batch Execute Transaction",
        description: "Single SmallTimelockAdmin.executeBatch to set oracle tolerance",
      },
      transactions: [],
    };
    const [target, value, payload, predecessor, salt] = output;
    const encodeResult = await encodeFunctionData("executeBatch", [target, value, payload, predecessor, salt], "SmallTimelockAdmin");

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
