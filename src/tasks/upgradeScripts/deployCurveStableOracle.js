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
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { CurveOracleKind } = require("../../test/utils/constants");

  const { deployer } = await getNamedAccounts();

  const addresses = getConfigByName("addresses.json");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const mediumTimeLock = await getContract("MediumTimelockAdmin");
  const Registry = await getContract("Registry");
  const PriceOracle = await getContract("PriceOracle");
  let tx;

  const mediumDelay = await mediumTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForMediumTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  if (!executeUpgrade) {
    const CurveStableOracle = await run("deploy:CurveStableOracle", {
      registry: Registry.address,
      priceOracle: PriceOracle.address,
      curveAddressProvider: addresses.curveAddressProvider,
    });

    argsForMediumTimeLock.targets.push(PriceOracle.address);
    argsForMediumTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "updateCurveTypeOracle",
          [[CurveOracleKind.STABLE], [CurveStableOracle.address]],
          "PriceOracle",
          PriceOracle.address,
        )
      ).payload,
    );
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
      argsMedium = JSON.parse(fs.readFileSync("./" + network.name + ". Update CurveStableOracle.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(mediumDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await mediumTimeLock.connect(impersonateAccount).executeBatch(...argsMedium.slice(0, argsMedium.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./" + network.name + ". Update CurveStableOracle.json", JSON.stringify(argsMedium, null, 2));
    if (!isFork) return;
    try {
      console.log("Scheduling...");
      tx = await mediumTimeLock.connect(impersonateAccount).scheduleBatch(...argsMedium);
      await tx.wait();

      console.log("Scheduling was successful");
    } catch (error) {
      console.log(error);
    }
  }
};
