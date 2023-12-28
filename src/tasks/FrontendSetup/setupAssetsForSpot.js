// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName, getConfig } = require("../../config/configUtils");
const path = require("path");
const fs = require("fs");

module.exports = async function (
  { tokens },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      constants: { HashZero },
      utils: { parseEther, parseUnits },
    },
  },
) {
  const { assets, pricefeeds } = getConfig();
  const pairsConfig = getConfigByName("pairsConfig.json");
  const { USD } = require("../../test/utils/constants.js");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const bigTimelockAdmin = await getContract("BigTimelockAdmin");
  const delay = (await bigTimelockAdmin.getMinDelay()).toString();

  const assetsArray = tokens.split(/\s*,\s*/);
  const priceFeedsAssetsForSpot = {};
  const pairsConfigAssetsForSpot = {};
  const output = {};

  for (const asset of assetsArray) {
    if (!assets[asset]) {
      throw new Error(`Address not found for token: ${asset}`);
    }
    const priceFeed = pricefeeds[`${asset}-usd`] || pricefeeds.selfDeployed?.[`${asset}-usd`];
    if (priceFeed) {
      priceFeedsAssetsForSpot[`${asset}-usd`] = priceFeed;
    } else {
      throw new Error(`Price feed not found for token: ${asset}`);
    }
  }

  for (const pairConfig in pairsConfig) {
    const assetsInPair = pairConfig.split("-");
    if (assetsArray.some(asset => assetsInPair.includes(asset))) {
      pairsConfigAssetsForSpot[pairConfig] = pairsConfig[pairConfig];
    }
  }

  const decimalsByAddress = {};
  for (const asset of assetsArray) {
    const targets = [];
    const payloads = [];

    // updatePriceFeed "newAsset-usd"
    let encodeResult = await encodeFunctionData(
      "updatePriceFeed",
      [assets[asset], USD, priceFeedsAssetsForSpot[`${asset}-usd`]],
      "PriceOracle",
    );
    targets.push(encodeResult.contractAddress);
    payloads.push(encodeResult.payload);

    // PairsConfig: maxPositionSize and oracleTolerableLimit
    for (const pairConfig in pairsConfigAssetsForSpot) {
      const assetsInPair = pairConfig.split("-");
      if (assetsInPair.includes(asset)) {
        const pairContracts = await Promise.all(
          assetsInPair.map(async assetName => {
            const assetAddress = assets[assetName];
            if (assetAddress) {
              return await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", assetAddress);
            } else {
              console.error(`Contract address for ${assetName} not found`);
              return null;
            }
          }),
        );

        if (decimalsByAddress[pairContracts[0].address] === undefined) {
          decimalsByAddress[pairContracts[0].address] = await pairContracts[0].decimals();
        }
        if (decimalsByAddress[pairContracts[1].address] === undefined) {
          decimalsByAddress[pairContracts[1].address] = await pairContracts[1].decimals();
        }

        const maxSize = pairsConfigAssetsForSpot[pairConfig].maxSize;
        const amount0 = parseUnits(maxSize[0].toString(), decimalsByAddress[pairContracts[0].address]);
        const amount1 = parseUnits(maxSize[1].toString(), decimalsByAddress[pairContracts[1].address]);

        encodeResult = await encodeFunctionData(
          "setMaxPositionSize",
          [pairContracts[0].address, pairContracts[1].address, amount0, amount1],
          "PositionManager",
        );
        targets.push(encodeResult.contractAddress);
        payloads.push(encodeResult.payload);

        if (pairsConfigAssetsForSpot[pairConfig].oracleTolerableLimit !== "0") {
          const oracleTolerableLimit = parseEther(pairsConfigAssetsForSpot[pairConfig].oracleTolerableLimit);

          encodeResult = await encodeFunctionData(
            "setOracleTolerableLimit",
            [pairContracts[0].address, pairContracts[1].address, oracleTolerableLimit],
            "PositionManager",
          );
          targets.push(encodeResult.contractAddress);
          payloads.push(encodeResult.payload);
        }
        delete pairsConfigAssetsForSpot[pairConfig];
      }
    }

    const values = new Array(targets.length).fill(0);

    if (!output[asset]) {
      output[asset] = {};
    }
    if (!output[asset].ForBigTimeLockAdmin) {
      output[asset].ForBigTimeLockAdmin = {};
    }
    output[asset].ForBigTimeLockAdmin = [targets, values, payloads, HashZero, HashZero, delay];
  }

  const pathToConfig = path.join(__dirname, "..", "..", "config");
  fs.writeFileSync(path.join(pathToConfig, network.name, "assetsForSpotSetupData.json"), JSON.stringify(output, null, 2));
  console.log("See data for timelocks are in 'assetsForSpotSetupData.json'");
};
