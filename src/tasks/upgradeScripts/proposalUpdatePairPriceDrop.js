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
  const priceOracleProxy = await getContract("PriceOracle_Proxy");
  const priceOracle = await getContractAt("PriceOracle", priceOracleProxy.address);

  const tokensToInclude = [];
  const tokensToExclude = [
    "pepe",
    "spell",
    "dodo",
    "grt",
    "woo",
    "crv",
    "knc",
    "xai",
    "tusd",
    "bal",
    "fxs",
    "tia",
    "rpl",
    "comp",
    "yfi",
    "cake",
    "aave",
    "uni",
    "sushi",
    "ldo",
    "joe",
    "dai",
  ];

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

    // set pair priceDrop
    const pairPriceDrop = pairsConfig[pair].pairPriceDrop.map(value => parseEther(value));
    if (!pairPriceDrop[0].isZero()) {
      argsForSmallTimeLock.targets.push(priceOracle.address);
      argsForSmallTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setPairPriceDrop",
            [pairContracts[0].address, pairContracts[1].address, pairPriceDrop[0]],
            "PriceOracle",
            priceOracle.address,
          )
        ).payload,
      );
      console.log(pair);
    }
    if (!pairPriceDrop[1].isZero()) {
      argsForSmallTimeLock.targets.push(priceOracle.address);
      argsForSmallTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setPairPriceDrop",
            [pairContracts[1].address, pairContracts[0].address, pairPriceDrop[1]],
            "PriceOracle",
            priceOracle.address,
          )
        ).payload,
      );
    }
  }

  const output = {
    targets: argsForSmallTimeLock.targets,
    values: Array(argsForSmallTimeLock.targets.length).fill(0),
    payloads: argsForSmallTimeLock.payloads,
    predecessor: predecessor,
    salt: salt,
    delay: smallDelay.toString(),
  };

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "SetPriceDrops");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetPriceDrops_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleData(output);
  const executeBatchData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetPriceDrops_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetPriceDrops_execute.json"), JSON.stringify(executeBatchData, null, 2));

  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Single Batch Schedule Transaction",
        description: "Single SmallTimelockAdmin.scheduleBatch to update pairPriceDrop for all assets from the list",
      },
      transactions: [],
    };
    const encodeResult = await encodeFunctionData(
      "scheduleBatch",
      [output.targets, output.values, output.payloads, output.predecessor, output.salt, output.delay],
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
        description: "Single SmallTimelockAdmin.executeBatch to update pairPriceDrop for all assets from the list",
      },
      transactions: [],
    };
    const encodeResult = await encodeFunctionData(
      "executeBatch",
      [output.targets, output.values, output.payloads, output.predecessor, output.salt],
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
