// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils.js");
const { NATIVE_CURRENCY } = require("../../test/utils/constants.js");
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
  const { assets, pricefeeds } = getConfig();
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const smallTimelockAdmin = await getContract("SmallTimelockAdmin");
  const delay = (await smallTimelockAdmin.getMinDelay()).toString();

  const chainId = (await provider.getNetwork()).chainId;

  // Add the List of token symbols
  const assetsArray = ["aave", "bal"];

  const tokens = [];
  const feeds = [];

  for (const asset of assetsArray) {
    if (!assets[asset]) {
      throw new Error(`Address not found for token: ${asset}`);
    }
    const priceFeed = pricefeeds[`${asset}-usd`] || pricefeeds.selfDeployed?.[`${asset}-usd`];

    if (priceFeed) {
      if (asset === "matic" && network.name === "polygon") {
        tokens.push(NATIVE_CURRENCY);
        feeds.push(priceFeed);
        continue;
      }
      if (asset === "eth" && (network.name === "ethereum" || network.name === "arbitrumOne")) {
        tokens.push(NATIVE_CURRENCY);
        feeds.push(priceFeed);
        continue;
      }

      tokens.push(assets[asset]);
      feeds.push(priceFeed);
    } else {
      throw new Error(`Price feed not found for token: ${asset}`);
    }
  }

  // updateChainlinkPriceFeedsUsd "newAsset-usd"
  const encodeResult = await encodeFunctionData("updateChainlinkPriceFeedsUsd", [tokens, feeds], "PriceOracle");

  const target = encodeResult.contractAddress;
  const payload = encodeResult.payload;
  const value = 0;
  const predecessor = HashZero;
  const salt = HashZero;

  const output = [target, value, payload, predecessor, salt, delay];

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "NewPriceFeeds");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetupPriceFeedsBatch_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output);
  const executeData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetupPriceFeedsBatch_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetupPriceFeedsBatch_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Schedule Transactions",
        description: "SmallTimelockAdmin.schedule with parameters to set price feeds for all assets from the list",
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
        description: "SmallTimelockAdmin.execute with parameters to set price feeds for all assets from the list",
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
