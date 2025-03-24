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
  const { getConfigByName, getConfig } = require("../../config/configUtils.js");
  const pairsConfig = getConfigByName("pairsConfig.json");
  const decimalsByAddress = {};
  const { assets } = getConfig();
  const chainId = (await provider.getNetwork()).chainId;

  // immutable
  const smallTimeLock = await getContract("SmallTimelockAdmin");

  const tokensToInclude = [];
  const tokensToExclude = [];

  const smallDelay = await smallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const output = {
    targets: null,
    values: null,
    payloads: null,
    predecessor: predecessor,
    salt: salt,
    smallDelay: smallDelay.toString(),
  };
  const maxPositionSizeParamsList = [];
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

    if (decimalsByAddress[pairContracts[0].address] === undefined) {
      decimalsByAddress[pairContracts[0].address] = await pairContracts[0].decimals();
    }
    if (decimalsByAddress[pairContracts[1].address] === undefined) {
      decimalsByAddress[pairContracts[1].address] = await pairContracts[1].decimals();
    }

    const maxSize = pairsConfig[pair].maxSize;
    const amount0 = parseUnits(maxSize[0].toString(), decimalsByAddress[pairContracts[0].address]);
    const amount1 = parseUnits(maxSize[1].toString(), decimalsByAddress[pairContracts[1].address]);

    if (!amount0.isZero() || !amount1.isZero()) {
      maxPositionSizeParamsList.push({
        token0: pairContracts[0].address,
        token1: pairContracts[1].address,
        amountInToken0: amount0,
        amountInToken1: amount1,
      });
      console.log(pair);
    }
  }
  if (maxPositionSizeParamsList.length > 0) {
    const { payload } = await encodeFunctionData("setMaxPositionSizes", [maxPositionSizeParamsList], "PositionManagerExtension");

    const encodeResult = await encodeFunctionData("setProtocolParamsByAdmin", [payload], "PositionManager");
    output.targets = encodeResult.contractAddress;
    output.payloads = encodeResult.payload;
    output.values = "0";
  }

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "SetMaxPositionSize");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetupPriceFeedsBatch_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output);
  const executeData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetMaxPositionSize_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetMaxPositionSize_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Schedule Transaction",
        description: "Single SmallTimelockAdmin.schedule to set max position size for all pairs from the list",
      },
      transactions: [],
    };

    const encodeResult = await encodeFunctionData(
      "schedule",
      [output.targets, output.values, output.payloads, predecessor, salt, smallDelay],
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
        name: "Execute Transaction",
        description: "SmallTimelockAdmin.execute to set max position size for all pairs from the list",
      },
      transactions: [],
    };

    const encodeResult = await encodeFunctionData(
      "execute",
      [output.targets, output.values, output.payloads, predecessor, salt],
      "SmallTimelockAdmin",
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
