// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, isFork },
  {
    run,
    network,
    upgrades,
    getNamedAccounts,
    deployments: { deploy, get },
    ethers: {
      getContractFactory,
      getContract,
      providers,
      constants: { HashZero },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils.js");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { deployer } = await getNamedAccounts();
  const addresses = getConfigByName("addresses.json");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const TiersManager = await getContract("TiersManager");
  let tx;

  const vePmxToken = {
    polygon: "0xD556f25a8150263B05f8fC1600d0A9bf012A3ed0",
    ethereum: "0x5EF0E0528D00832abC9C01b5893b00c7D8C3F550",
    arbitrumOne: "0x72C3aA44AA0A58bb180871AD9b18D03F45bD77E8",
    baseMainnet: "0x4C7876977ECe31fDb8e932e17977D4C93DB1938F"
  };

  const bigDelay = await bigTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  async function upgradeProxyWithCheck({ proxyAddress, contractName, libraries, isBeacon }) {
    // const newImplFactory = await getContractFactory(contractName, { libraries });
    // check upgrade
    // await upgrades.validateUpgrade(proxyAddress, newImplFactory, {
    //   unsafeAllow: ["constructor", "external-library-linking", "delegatecall"],
    // });
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
  if (!executeUpgrade) {
    /**
     * TiersManager upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: TiersManager.address,
      contractName: "TiersManager",
      libraries: {},
      isBeacon: false,
    });

    // set vePMX to the TiersManager
    argsForBigTimeLock.targets.push(TiersManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setPMX", [vePmxToken[network.name]], "TiersManager", TiersManager.address)).payload,
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
      argsBig = JSON.parse(fs.readFileSync("./" + network.name + " Upgrade TiersManager for vePMX.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(bigDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await bigTimeLock.connect(impersonateAccount).executeBatch(...argsBig.slice(0, argsBig.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./" + network.name + " Upgrade TiersManager for vePMX.json", JSON.stringify(argsBig, null, 2));
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
