// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, isFork },
  {
    run,
    network,
    getNamedAccounts,
    ethers: {
      getContract,
      providers,
      constants: { HashZero },
      utils: { defaultAbiCoder, parseUnits },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { BAR_CALC_PARAMS_DECODE } = require("../../test/utils/constants.js");
  const { getConfigByName } = require("../../config/configUtils");

  const { networks } = require("../../hardhat.config.js");

  const { deployer } = await getNamedAccounts();

  // immutable addresses
  const MediumTimelockAdmin = await getContract("MediumTimelockAdmin");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x8ac7230489e80000"]);
  }

  let tx;
  const mediumDelay = await MediumTimelockAdmin.getMinDelay();
  const addresses = getConfigByName("addresses.json");

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForMediumTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const params = [
    {
      bucket: "0x12c125181Eb7c944EaEfcB2AE881475870f0Aff3",
      barCalcParams: {
        urOptimal: "0.8",
        k0: "0.3113",
        k1: "2.675",
        b0: "0.001",
        b1: "-1.89",
      },
    },
    {
      bucket: "0x4E0a6Ea3BeB2f89a4F51e09d0170DEfcC0f32734",
      barCalcParams: {
        urOptimal: "0.8",
        k0: "0.3113",
        k1: "2.675",
        b0: "0.001",
        b1: "-1.89",
      },
    },
  ];

  for (const i in params) {
    const { bucket, barCalcParams } = params[i];

    for (const [key, value] of Object.entries(barCalcParams)) {
      barCalcParams[key] = parseUnits(value, 27).toString();
    }
    const encodeParams = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [
      [barCalcParams.urOptimal, barCalcParams.k0, barCalcParams.k1, barCalcParams.b0, barCalcParams.b1],
    ]);

    argsForMediumTimeLock.targets.push(bucket);
    argsForMediumTimeLock.payloads.push((await encodeFunctionData("setBarCalculationParams", [encodeParams], "Bucket", bucket)).payload);
  }

  let argsMedium = [
    argsForMediumTimeLock.targets,
    Array(argsForMediumTimeLock.targets.length).fill(0),
    argsForMediumTimeLock.payloads,
    predecessor,
    salt,
    mediumDelay.toString(),
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
      argsMedium = JSON.parse(fs.readFileSync("./argsForMediumTimeLock.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(mediumDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await MediumTimelockAdmin.connect(impersonateAccount).executeBatch(...argsMedium.slice(0, argsMedium.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./argsForMediumTimeLock.json", JSON.stringify(argsMedium, null, 2));
    if (!isFork) return;
    try {
      console.log("Scheduling...");
      tx = await MediumTimelockAdmin.connect(impersonateAccount).scheduleBatch(...argsMedium);
      await tx.wait();

      console.log("Scheduling was successful");
    } catch (error) {
      console.log(error);
    }
  }
};
