// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, executeFromDeployer },
  {
    ethers: {
      getContract,
      getContractAt,
      constants: { HashZero },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfig } = require("../../config/configUtils.js");
  const { dexes } = getConfig();

  // immutable
  const mediumTimeLock = await getContract("MediumTimelockAdmin");
  const primexDNSProxy = await getContract("PrimexDNS_Proxy");
  const primexDNS = await getContractAt("PrimexDNS", primexDNSProxy.address);
  const dexAdapter = await getContract("DexAdapter");
  let tx;

  const mediumDelay = await mediumTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForMediumTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const existingDexes = await primexDNS.getAllDexes();

  console.log(`existingDexes = ${existingDexes}`);

  const routers = [];
  const name = [];
  const dexTypes = [];
  const quoters = {};

  for (const dex in dexes) {
    const dexName = dex;
    const dexRouter = dexes[dex].router;

    if (!existingDexes.includes(dexName)) {
      name.push(dexName);
      dexTypes.push(dexes[dex].type);
      routers.push(dexRouter);
      if (dexes[dex].quoter !== undefined) {
        quoters[routers.length - 1] = dexes[dex].quoter;
      }
    }
  }
  console.log(`newDexes = ${name}`);

  if (name.length !== routers.length) throw new Error("length of router addresses and the length of the names do not match");
  if (dexTypes.length !== routers.length) throw new Error("length of router addresses and the length of the dex types do not match");

  if (executeFromDeployer) {
    // add dexes to DNS
    for (let i = 0; i < name.length; i++) {
      tx = await primexDNS.addDEX(name[i], routers[i]);
      await tx.wait();
      console.log(`AddedToDNS dexName: ${name[i]}, routerAddress: ${routers[i]}`);
    }

    // set dex types
    for (let i = 0; i < name.length; i++) {
      tx = await dexAdapter.setDexType(routers[i], dexTypes[i]);
      await tx.wait();
    }

    // set quoters
    if (quoters) {
      for (const key in quoters) {
        const tx = await dexAdapter.setQuoter(routers[key], quoters[key]);
        await tx.wait();
      }
    }
    console.log("New Dexes added successfully!!");
  } else {
    // add dexes to DNS
    for (let i = 0; i < name.length; i++) {
      argsForMediumTimeLock.targets.push(primexDNS.address);
      argsForMediumTimeLock.payloads.push(
        (await encodeFunctionData("addDEX", [name[i], routers[i]], "PrimexDNS", primexDNS.address)).payload,
      );
    }

    // set dex types
    for (let i = 0; i < name.length; i++) {
      argsForMediumTimeLock.targets.push(dexAdapter.address);
      argsForMediumTimeLock.payloads.push(
        (await encodeFunctionData("setDexType", [routers[i], dexTypes[i]], "DexAdapter", dexAdapter.address)).payload,
      );
    }

    // set quoters
    if (quoters) {
      for (const key in quoters) {
        argsForMediumTimeLock.targets.push(dexAdapter.address);
        argsForMediumTimeLock.payloads.push(
          (await encodeFunctionData("setQuoter", [routers[key], quoters[key]], "DexAdapter", dexAdapter.address)).payload,
        );
      }
    }
  }

  let argsMedium = [
    argsForMediumTimeLock.targets,
    Array(argsForMediumTimeLock.targets.length).fill(0),
    argsForMediumTimeLock.payloads,
    predecessor,
    salt,
    mediumDelay.toString(),
  ];

  if (!executeFromDeployer) {
    if (executeUpgrade) {
      try {
        argsMedium = JSON.parse(fs.readFileSync("./argsForMediumTimeLock.json"));

        tx = await mediumTimeLock.executeBatch(...argsMedium.slice(0, argsMedium.length - 1));
        await tx.wait();

        console.log("Executing was successful");
      } catch (error) {
        console.log(error);
      }
    } else {
      fs.writeFileSync("./argsForMediumTimeLockAddNewDexes.json", JSON.stringify(argsMedium, null, 2));
      try {
        console.log("Scheduling...");
        tx = await mediumTimeLock.scheduleBatch(...argsMedium);
        await tx.wait();

        console.log("Scheduling was successful");
      } catch (error) {
        console.log(error);
      }
    }
  }
};
