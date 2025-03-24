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
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { deployer } = await getNamedAccounts();
  const addresses = getConfigByName("addresses.json");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const DepositManager = await getContract("DepositManager");
  const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
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
     * DepositManager upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: DepositManager.address,
      contractName: "DepositManager",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
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
