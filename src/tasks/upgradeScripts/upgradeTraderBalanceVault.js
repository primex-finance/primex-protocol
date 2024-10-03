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
      getContract,
      providers,
      constants: { HashZero },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");

  const { deployer } = await getNamedAccounts();

  const addresses = getConfigByName("addresses.json");

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const TraderBalanceVault = await getContract("TraderBalanceVault");
  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  async function upgradeProxyWithoutCheck({ proxyAddress, contractName, libraries, isBeacon }) {
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
    /**
     * ActivityRewardDistributor upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: TraderBalanceVault.address,
      contractName: "TraderBalanceVault",
      libraries: {},
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

  const rpcUrl = networks[network.name].url;
  const impersonateAddress = addresses.adminAddress; // gnosis
  const provider = new providers.JsonRpcProvider(rpcUrl);
  await provider.send("hardhat_impersonateAccount", [impersonateAddress]);
  const impersonateAccount = provider.getSigner(impersonateAddress);

  if (!executeFromDeployer) {
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

      try {
        console.log("Scheduling...");
        tx = await bigTimeLock.connect(impersonateAccount).scheduleBatch(...argsBig);
        await tx.wait();

        console.log("Scheduling was successful");
      } catch (error) {
        console.log(error);
      }
    }
  }
};
