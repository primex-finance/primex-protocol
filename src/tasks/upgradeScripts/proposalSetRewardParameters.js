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
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");

  const addresses = getConfigByName("addresses.json");

  // immutable addresses
  const smallTimeLock = await getContract("SmallTimelockAdmin");
  const DepositManager = await getContract("DepositManager");
  const EPMXToken = await getContract("EPMXToken");

  let tx;

  const smallDelay = await smallTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForSmallTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  if (!executeUpgrade) {
    const rewardParameters = [
      {
        bucket: "0x12c125181Eb7c944EaEfcB2AE881475870f0Aff3",
        rewardTokens: [EPMXToken.address],
        durations: [[100]],
        newInterestRates: [[100]],
        maxTotalDeposit: "1000",
      },
    ];

    // set reward parameters
    argsForSmallTimeLock.targets.push(DepositManager.address);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("setRewardParameters", [rewardParameters], "DepositManager", DepositManager.address)).payload,
    );
  }

  let argsSmall = [
    argsForSmallTimeLock.targets,
    Array(argsForSmallTimeLock.targets.length).fill(0),
    argsForSmallTimeLock.payloads,
    predecessor,
    salt,
    smallDelay.toString(),
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
      argsSmall = JSON.parse(fs.readFileSync("./argsForSmallTimeLock.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(smallDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await smallTimeLock.connect(impersonateAccount).executeBatch(...argsSmall.slice(0, argsSmall.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./argsForSmallTimeLock.json", JSON.stringify(argsSmall, null, 2));
    if (!isFork) return;
    try {
      console.log("Scheduling...");
      tx = await smallTimeLock.connect(impersonateAccount).scheduleBatch(...argsSmall);
      await tx.wait();

      console.log("Scheduling was successful");
    } catch (error) {
      console.log(error);
    }
  }
};
