// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName, getConfig } = require("../../config/configUtils");

module.exports = async function (
  { positionManager, priceOracle },
  {
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits, parseEther },
    },
  },
) {
  const pairsConfig = getConfigByName("pairsConfig.json");

  if (!positionManager) {
    positionManager = (await getContract("PositionManager")).address;
  }
  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }
  const contractPositionManager = await getContractAt("PositionManager", positionManager);
  const contractPriceOracle = await getContractAt("PriceOracle", priceOracle);

  const decimalsByAddress = {};

  const { assets } = getConfig();
  for (const pair in pairsConfig) {
    const pairContracts = await Promise.all(
      pair.split("-").map(async asset => {
        try {
          return await getContractAt("ERC20", assets[asset]);
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
    // set max position size
    const amount0 = parseUnits(pairsConfig[pair].maxSize[0].toString(), decimalsByAddress[pairContracts[0].address]);
    const amount1 = parseUnits(pairsConfig[pair].maxSize[1].toString(), decimalsByAddress[pairContracts[1].address]);

    let tx = await contractPositionManager.setMaxPositionSize(pairContracts[0].address, pairContracts[1].address, amount0, amount1);
    await tx.wait();
    //

    // set pair priceDrop
    const pairPriceDrop = pairsConfig[pair].pairPriceDrop.map(value => parseEther(value));
    if (!pairPriceDrop[0].isZero()) {
      tx = await contractPriceOracle.setPairPriceDrop(pairContracts[0].address, pairContracts[1].address, pairPriceDrop[0]);
      await tx.wait();
    }
    if (!pairPriceDrop[1].isZero()) {
      tx = await contractPriceOracle.setPairPriceDrop(pairContracts[1].address, pairContracts[0].address, pairPriceDrop[1]);
      await tx.wait();
    }
    //

    // set oracle tolerable limit
    if (pairsConfig[pair].oracleTolerableLimit !== "0") {
      const oracleTolerableLimit = parseEther(pairsConfig[pair].oracleTolerableLimit);
      tx = await contractPositionManager.setOracleTolerableLimit(pairContracts[0].address, pairContracts[1].address, oracleTolerableLimit);
      await tx.wait();
    }
    //
  }

  console.log("Pairs config is set up!");
};
