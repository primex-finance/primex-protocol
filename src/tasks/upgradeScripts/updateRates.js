// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, executeFromDeployer },
  {
    run,
    network,
    getNamedAccounts,
    deployments: { deploy, get },
    ethers: {
      provider,
      getContract,
      getContractAt,
      getContractFactory,
      utils: { parseEther, parseUnits },
      constants: { HashZero, MaxUint256, Zero },
    },
    upgrades,
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const { OrderType, NATIVE_CURRENCY } = require("../../test/utils/constants");

  // immutable
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PMXToken = await getContract("EPMXToken");

  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const changeableRates = {
    MARKET_ORDER: {
      protocolRate: "0",
      protocolRateInPmx: "0",
    },
    SWAP_LIMIT_ORDER: {
      protocolRate: "0.003",
      protocolRateInPmx: "0.0024",
    },
  };

  const changeableFeeRestictions = {
    MARKET_ORDER: {
      minProtocolFee: "1",
      maxProtocolFee: "MaxUint256",
    },
    LIMIT_ORDER: {
      minProtocolFee: "1",
      maxProtocolFee: "MaxUint256",
    },
  };

  const rates = [];
  const restrictions = [];

  for (const key in changeableRates) {
    rates.push({
      orderType: OrderType[key],
      feeToken: PMXToken.address,
      rate: parseUnits(changeableRates[key].protocolRateInPmx, 18).toString(),
    });
    rates.push({
      orderType: OrderType[key],
      feeToken: NATIVE_CURRENCY,
      rate: parseUnits(changeableRates[key].protocolRate, 18).toString(),
    });
  }

  for (const key in changeableFeeRestictions) {
    const minProtocolFee = changeableFeeRestictions[key].minProtocolFee;
    const maxProtocolFee = changeableFeeRestictions[key].maxProtocolFee;
    const orderRestrictions = {
      minProtocolFee: (minProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(minProtocolFee)).toString(),
      maxProtocolFee: (maxProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(maxProtocolFee)).toString(),
    };
    restrictions.push({ orderType: OrderType[key], orderRestrictions: orderRestrictions });
  }

  if (executeFromDeployer) {
    // rates
    for (const rate of rates) {
      tx = await PrimexDNS.setFeeRate(rate);
      await tx.wait();
    }

    // restrictions
    for (const restriction of restrictions) {
      tx = await PrimexDNS.setFeeRestrictions(restriction.orderType, restriction.orderRestrictions);
      await tx.wait();
    }
  } else {
    // rates
    for (const rate of rates) {
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push((await encodeFunctionData("setFeeRate", [rate], "PrimexDNS", PrimexDNS.address)).payload);
    }

    // rates
    for (const restriction of restrictions) {
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setFeeRestrictions",
            [restriction.orderType, restriction.orderRestrictions],
            "PrimexDNS",
            PrimexDNS.address,
          )
        ).payload,
      );
    }
  }

  let argsBig = [
    argsForBigTimeLock.targets,
    Array(argsForBigTimeLock.targets.length).fill(0),
    argsForBigTimeLock.payloads,
    predecessor,
    salt,
    bigDelay.toString(),
  ];

  if (!executeFromDeployer) {
    if (executeUpgrade) {
      try {
        argsBig = JSON.parse(fs.readFileSync("./argsForBigTimeLock.json"));

        tx = await bigTimeLock.executeBatch(...argsBig.slice(0, argsBig.length - 1));
        await tx.wait();

        console.log("Executing was successful");
      } catch (error) {
        console.log(error);
      }
    } else {
      fs.writeFileSync("./argsForBigTimeLock.json", JSON.stringify(argsBig, null, 2));
      try {
        console.log("Scheduling...");
        tx = await bigTimeLock.scheduleBatch(...argsBig);
        await tx.wait();

        console.log("Scheduling was successful");
      } catch (error) {
        console.log(error);
      }
    }
  }
};
