// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, isFork },
  {
    network,
    ethers: {
      getContract,
      providers,
      constants: { HashZero },
      utils: { parseUnits, parseEther },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { USD_DECIMALS } = require("../../test/utils/constants.js");

  const { networks } = require("../../hardhat.config.js");

  const generalConfig = getConfigByName("generalConfig.json");
  const addresses = getConfigByName("addresses.json");

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const smallTimelock = await getContract("SmallTimelockAdmin");
  const DepositManager = await getContract("DepositManager");
  const EPMXToken = await getContract("EPMXToken");
  const Treasury = await getContract("Treasury");
  const WhiteBlackList = await getContract("WhiteBlackList");

  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  // VARS:
  const maxAmount = parseEther("10000000");
  const maxPercent = parseEther("0.05");

  if (!executeUpgrade) {
    // Add deposit manager to WL
    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addAddressesToWhitelist", [[DepositManager.address]], "WhiteBlackList", WhiteBlackList.address)).payload,
    );

    // set EPMX Price
    const price = parseUnits(generalConfig.EPMXOraclePrice, USD_DECIMALS);
    const EPMXPriceFeed = await getContract("EPMXPriceFeed");
    argsForBigTimeLock.targets.push(EPMXPriceFeed.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setAnswer", [price.toString()], "EPMXPriceFeed", EPMXPriceFeed.address)).payload,
    );

    // Add Deposit Manager to EPMX's white list
    argsForBigTimeLock.targets.push(EPMXToken.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addAddressToWhitelist", [DepositManager.address], "EPMXToken", EPMXToken.address)).payload,
    );

    // allow small timelock admin spend funds from treasury
    argsForBigTimeLock.targets.push(Treasury.address);

    const spendingLimits = {
      maxTotalAmount: maxAmount,
      maxAmountPerTransfer: maxAmount,
      maxPercentPerTransfer: maxPercent,
      minTimeBetweenTransfers: 0,
      timeframeDuration: 1,
      maxAmountDuringTimeframe: maxAmount,
    };

    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "setMaxSpendingLimit",
          [smallTimelock.address, EPMXToken.address, spendingLimits],
          "Treasury",
          Treasury.address,
        )
      ).payload,
    );
  }

  let argsBig = [
    argsForBigTimeLock.targets,
    Array(argsForBigTimeLock.targets.length).fill(0),
    argsForBigTimeLock.payloads,
    predecessor,
    salt,
    bigDelay.toString(),
  ];

  let impersonateAccount;
  const rpcUrl = networks[network.name].url;
  const provider = new providers.JsonRpcProvider(rpcUrl);
  if (isFork) {
    const impersonateAddress = addresses.adminAddress; // gnosis
    await provider.send("hardhat_impersonateAccount", [impersonateAddress]);
    await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);

    impersonateAccount = provider.getSigner(impersonateAddress);
  }

  if (executeUpgrade) {
    try {
      argsBig = JSON.parse(fs.readFileSync("./argsForBigTimeLock.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(bigDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await bigTimeLock.connect(impersonateAccount).executeBatch(...argsBig.slice(0, argsBig.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./argsForBigTimeLock.json", JSON.stringify(argsBig, null, 2));
    if (!isFork) return;
    try {
      console.log("Scheduling...");
      tx = await bigTimeLock.connect(impersonateAccount).scheduleBatch(...argsBig);
      await tx.wait();

      console.log("Scheduling was successful");
    } catch (error) {
      console.log(error);
    }
  }
};
