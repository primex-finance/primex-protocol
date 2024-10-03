// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");

module.exports = async function (
  { executeUpgrade, executeFromDeployer },
  {
    ethers: {
      getContract,
      getContractAt,
      constants: { HashZero },
      utils: { parseUnits, parseEther },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfigByName, getConfig } = require("../../config/configUtils.js");
  const pairsConfig = getConfigByName("pairsConfig.json");
  const decimalsByAddress = {};
  const { assets } = getConfig();

  // immutable
  const smallTimeLock = await getContract("SmallTimelockAdmin");
  const priceOracleProxy = await getContract("PriceOracle_Proxy");
  const priceOracle = await getContractAt("PriceOracle", priceOracleProxy.address);

  let tx;

  const smallDelay = await smallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForSmallTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  if (executeFromDeployer) {
    for (const pair in pairsConfig) {
      const pairContracts = await Promise.all(
        pair.split("-").map(async asset => {
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
      console.log(pair);
      if (decimalsByAddress[pairContracts[0].address] === undefined) {
        decimalsByAddress[pairContracts[0].address] = await pairContracts[0].decimals();
      }
      if (decimalsByAddress[pairContracts[1].address] === undefined) {
        decimalsByAddress[pairContracts[1].address] = await pairContracts[1].decimals();
      }
      // set pair priceDrop
      const pairPriceDrop = pairsConfig[pair].pairPriceDrop.map(value => parseEther(value));
      if (!pairPriceDrop[0].isZero()) {
        tx = await priceOracle.setPairPriceDrop(pairContracts[0].address, pairContracts[1].address, pairPriceDrop[0]);
        await tx.wait();
      }
      if (!pairPriceDrop[1].isZero()) {
        tx = await priceOracle.setPairPriceDrop(pairContracts[1].address, pairContracts[0].address, pairPriceDrop[1]);
        await tx.wait();
      }
    }
  } else {
    for (const pair in pairsConfig) {
      const pairContracts = await Promise.all(
        pair.split("-").map(async asset => {
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
      console.log(pair);
      if (decimalsByAddress[pairContracts[0].address] === undefined) {
        decimalsByAddress[pairContracts[0].address] = await pairContracts[0].decimals();
      }
      if (decimalsByAddress[pairContracts[1].address] === undefined) {
        decimalsByAddress[pairContracts[1].address] = await pairContracts[1].decimals();
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
  }

  const argsSmall = [
    argsForSmallTimeLock.targets,
    Array(argsForSmallTimeLock.targets.length).fill(0),
    argsForSmallTimeLock.payloads,
    predecessor,
    salt,
    smallDelay.toString(),
  ];

  fs.writeFileSync("./argsForSmallTimeLockUpdatePairPriceDrop.json", JSON.stringify(argsSmall, null, 2));
};
