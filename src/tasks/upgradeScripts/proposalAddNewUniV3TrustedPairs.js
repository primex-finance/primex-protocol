// SPDX-License-Identifier: BUSL-1.1
const { getConfig, getConfigByName } = require("../../config/configUtils.js");
const path = require("path");
const fs = require("fs");

module.exports = async function (
  { __ },
  {
    network,
    ethers: {
      getContract,
      constants: { HashZero },
      provider,
    },
  },
) {
  // Load the Univ3TrustedPairs.json configuration
  const trustedPairsConfig = getConfigByName("Univ3TrustedPairs.json");
  const { assets } = getConfig(); // Assuming you have a function to get asset addresses
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const smallTimelockAdmin = await getContract("SmallTimelockAdmin");
  const delay = (await smallTimelockAdmin.getMinDelay()).toString();
  const chainId = (await provider.getNetwork()).chainId;

  const tokensToInclude = [];
  const tokensToExclude = ["pepe", "spell"];
  const updateParams = [];

  // Loop through the trusted pairs from Univ3TrustedPairs.json
  for (const pairName in trustedPairsConfig) {
    const [tokenA, tokenB] = pairName.split("-");
    if (tokensToInclude.length !== 0) {
      // set uniV3TrustedPairs only if at least one of the tokens belongs to the list
      if (!tokensToInclude.includes(tokenA) && !tokensToInclude.includes(tokenB)) {
        continue;
      }
    }

    if (tokensToExclude.length !== 0) {
      // set uniV3TrustedPairs only if none of the tokens belongs to the list
      if (tokensToExclude.includes(tokenA) || tokensToExclude.includes(tokenB)) {
        continue;
      }
    }
    // Ensure both tokens exist in the assets configuration
    if (!assets[tokenA] || !assets[tokenB]) {
      throw new Error(`Address not found for token pair: ${tokenA}-${tokenB}`);
    }

    // Build the `UpdateUniv3TrustedPairParams` struct for each pair
    const params = {
      oracleType: trustedPairsConfig[pairName].oracleType,
      tokenA: assets[tokenA],
      tokenB: assets[tokenB],
      isTrusted: trustedPairsConfig[pairName].isTrusted,
    };

    // Add to the array of update parameters
    updateParams.push(params);
  }

  const encodeResult = await encodeFunctionData("updateUniv3TrustedPair", [updateParams], "PriceOracle");

  const target = encodeResult.contractAddress;
  const payload = encodeResult.payload;
  const value = 0;
  const predecessor = HashZero;
  const salt = HashZero;

  const output = [target, value, payload, predecessor, salt, delay];

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "UpdateUniv3TrustedPairs");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetupUniv3TrustedPairs_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output);
  const executeData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetupUniv3TrustedPairs_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetupUniv3TrustedPairs_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Schedule Transaction",
        description: "SmallTimelockAdmin.schedule with parameters to update Univ3 trusted pairs",
      },
      transactions: [],
    };

    const [target, value, payload, predecessor, salt, delay] = output;
    const encodeResult = await encodeFunctionData("schedule", [target, value, payload, predecessor, salt, delay], "SmallTimelockAdmin");

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
        description: "SmallTimelockAdmin.execute with parameters to update Univ3 trusted pairs",
      },
      transactions: [],
    };

    const [target, value, payload, predecessor, salt] = output;
    const encodeResult = await encodeFunctionData("execute", [target, value, payload, predecessor, salt], "SmallTimelockAdmin");

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
