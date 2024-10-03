// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, executeFromDeployer },
  {
    getNamedAccounts,
    deployments: { deploy, get },
    ethers: {
      getContract,
      getContractAt,
      getContractFactory,
      constants: { HashZero },
      utils: { parseEther },
    },
    upgrades,
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfig } = require("../../config/configUtils");

  const { deployer } = await getNamedAccounts();

  const { dexes } = getConfig();
  const routers = [];
  const name = [];
  const dexTypes = [];
  const quoters = {};

  for (const dex in dexes) {
    name.push(dex);
    dexTypes.push(dexes[dex].type);
    routers.push(dexes[dex].router);
    if (dexes[dex].quoter !== undefined) {
      quoters[routers.length - 1] = dexes[dex].quoter;
    }
  }

  if (name.length !== routers.length) throw new Error("length of router addresses and the length of the names do not match");
  if (dexTypes.length !== routers.length) throw new Error("length of router addresses and the length of the dex types do not match");

  // immutable
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactoryV2");
  const Registry = await getContract("Registry");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  async function upgradeProxyWithCheck({ proxyAddress, contractName, implArtifactName, libraries, isBeacon }) {
    const newImplFactory = await getContractFactory(contractName, { libraries });
    const oldImplArtifact = await get(implArtifactName);
    const oldImplFactory = await getContractFactory(oldImplArtifact.abi, oldImplArtifact.bytecode);

    // check upgrade
    await upgrades.forceImport(proxyAddress, oldImplFactory, isBeacon ? { kind: "beacon" } : {});
    await upgrades.validateUpgrade(proxyAddress, newImplFactory, {
      unsafeAllow: ["constructor", "external-library-linking", "delegatecall"],
    });

    // deploy new implementation
    const NewImplementation = await deploy(implArtifactName, {
      contract: contractName,
      from: deployer,
      log: true,
      libraries,
    });
    if (executeFromDeployer) {
      if (isBeacon) {
        tx = await PrimexProxyAdmin.upgradeBeacon(proxyAddress, NewImplementation.address);
      } else {
        tx = await PrimexProxyAdmin.upgrade(proxyAddress, NewImplementation.address);
      }
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(PrimexProxyAdmin.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            isBeacon ? "upgradeBeacon" : "upgrade",
            [proxyAddress, NewImplementation.address],
            "PrimexProxyAdmin",
            PrimexProxyAdmin.address,
          )
        ).payload,
      );
    }
    return NewImplementation;
  }

  /**
   * TokenApproveLibrary deploy
   */
  const TokenApproveLibrary = await deploy("TokenApproveLibrary", {
    from: deployer,
    args: [],
    log: true,
  });

  /**
   * DexAdapter deploy
   */
  const oldDexAdapter = await getContract("DexAdapter");
  await deploy("DexAdapter", {
    from: deployer,
    args: [Registry.address],
    log: true,
    libraries: {
      TokenApproveLibrary: TokenApproveLibrary.address,
    },
  });
  const dexAdapter = await getContract("DexAdapter");

  /**
   * Bucket upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: BucketsFactory.address,
    contractName: "Bucket",
    implArtifactName: "Bucket",
    libraries: {
      TokenTransfersLibrary: TokenTransfersLibrary.address,
      TokenApproveLibrary: TokenApproveLibrary.address,
    },
    isBeacon: true,
  });

  if (executeFromDeployer) {
    // add new dexAdapter to whitelist
    tx = await WhiteBlackList.addAddressToWhitelist(dexAdapter.address);
    await tx.wait();

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
    // set DexAdapter
    tx = await PrimexDNS.setDexAdapter(dexAdapter.address);
    await tx.wait();

    // remove old dexAdapter from whitelist
    tx = await WhiteBlackList.removeAddressFromWhitelist(oldDexAdapter.address);
    await tx.wait();
  } else {
    // add new dexAdapter to whitelist
    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addAddressToWhitelist", [dexAdapter.address], "WhiteBlackList", WhiteBlackList.address)).payload,
    );

    // set dex types
    for (let i = 0; i < name.length; i++) {
      argsForBigTimeLock.targets.push(dexAdapter.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setDexType", [routers[i], dexTypes[i]], "DexAdapter", dexAdapter.address)).payload,
      );
    }

    // set quoters
    if (quoters) {
      for (const key in quoters) {
        argsForBigTimeLock.targets.push(dexAdapter.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setQuoter", [routers[key], quoters[key]], "DexAdapter", dexAdapter.address)).payload,
        );
      }
    }

    // set DexAdapter
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setDexAdapter", [dexAdapter.address], "PrimexDNS", PrimexDNS.address)).payload,
    );

    // remove old dexAdapter from whitelist
    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("removeAddressFromWhitelist", [oldDexAdapter.address], "WhiteBlackList", WhiteBlackList.address)).payload,
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
