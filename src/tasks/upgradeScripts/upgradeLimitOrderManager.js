// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, executeFromDeployer },
  {
    run,
    getNamedAccounts,
    deployments: { deploy, get },
    ethers: {
      getContract,
      getContractFactory,
      constants: { HashZero },
    },
    upgrades,
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { deployer } = await getNamedAccounts();

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");

  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  async function upgradeProxyWithCheck({ proxyAddress, contractName, libraries, isBeacon }) {
    const newImplFactory = await getContractFactory(contractName, { libraries });
    // check upgrade
    await upgrades.validateUpgrade(proxyAddress, newImplFactory, {
      unsafeAllow: ["constructor", "external-library-linking", "delegatecall"],
    });
    // deploy new implementation
    let NewImplementation;
    try {
      await deploy(contractName, {
        contract: contractName,
        from: deployer,
        log: true,
        proxy: !isBeacon,
        libraries,
      });
      NewImplementation = await get(isBeacon ? contractName : `${contractName}_Implementation`);
    } catch (e) {
      try {
        await deploy(contractName, {
          contract: contractName,
          from: deployer,
          log: true,
          proxy: !isBeacon,
          libraries,
        });
        NewImplementation = await get(isBeacon ? contractName : `${contractName}_Implementation`);
      } catch (e) {
        throw new Error(e);
      }
    }

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
  }

  if (!executeUpgrade) {
    const LimitOrderLibrary = await run("deploy:LimitOrderLibrary", {
      primexPricingLibrary: PrimexPricingLibrary.address,
      tokenTransfersLibrary: TokenTransfersLibrary.address,
    });

    /**
     * LimitOrderManager upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: LimitOrderManager.address,
      contractName: "LimitOrderManager",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        LimitOrderLibrary: LimitOrderLibrary.address,
      },
      isBeacon: false,
    });
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
