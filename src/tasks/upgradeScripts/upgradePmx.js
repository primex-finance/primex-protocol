// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, isFork },
  {
    run,
    network,
    getNamedAccounts,
    deployments: { deploy, get },
    ethers: {
      getContract,
      providers,
      getContractAt,
      constants: { HashZero },
      utils: { parseUnits },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { deployer } = await getNamedAccounts();
  const addresses = getConfigByName("addresses.json");
  const { USD_DECIMALS } = require("../../test/utils/constants.js");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const PriceOracle = await getContract("PriceOracle");
  const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
  const TiersManager = await getContract("TiersManager");
  const generalConfig = getConfigByName("generalConfig.json");
  const Registry = await getContract("Registry");
  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const pmxToken = {
    polygon: "0x0B3EAEAd748facDb9d943d3407011f16Eb17D0Cf",
    ethereum: "0x0B3EAEAd748facDb9d943d3407011f16Eb17D0Cf",
    arbitrumOne: "0x0B3EAEAd748facDb9d943d3407011f16Eb17D0Cf",
    baseMainnet: "0x0B3EAEAd748facDb9d943d3407011f16Eb17D0Cf",
  };

  if (isFork) {
    const MockPmx = await deploy("MockPMXToken", {
      from: deployer,
      contract: "EPMXToken",
      args: [deployer, Registry.address],
      log: true,
    });
    pmxToken[network.name] = MockPmx.address;
  }

  async function upgradeProxyWithCheck({ proxyAddress, contractName, libraries, isBeacon }) {
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
    // const PMXPriceFeed = await run("deploy:PMXPriceFeed", {
    //   registry: Registry.address,
    // });

    const PMXPriceFeed = await getContract("PMXPriceFeed");

    const price = parseUnits(generalConfig.PMXOraclePrice, USD_DECIMALS);
    argsForBigTimeLock.targets.push(PMXPriceFeed.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setAnswer", [price.toString()], "PMXPriceFeed", PMXPriceFeed.address)).payload,
    );

    /**
     * KeeperRewardDistributor upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: KeeperRewardDistributor.address,
      contractName: "KeeperRewardDistributor",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * DNS upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PrimexDNS.address,
      contractName: "PrimexDNS",
      libraries: {},
      isBeacon: false,
    });

    // sets pmx to the KeeperRewardDistributor
    argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setPMX", [pmxToken[network.name]], "KeeperRewardDistributor", KeeperRewardDistributor.address)).payload,
    );

    // set PMX to the DNS
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setPMX", [pmxToken[network.name]], "PrimexDNS", PrimexDNS.address)).payload,
    );

    // set PMX to the TiersManager
    argsForBigTimeLock.targets.push(TiersManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setPMX", [pmxToken[network.name]], "TiersManager", TiersManager.address)).payload,
    );

    // update price feed for the new token
    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "updateChainlinkPriceFeedsUsd",
          [[pmxToken[network.name]], [PMXPriceFeed.address]],
          "PriceOracle",
          PriceOracle.address,
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
      argsBig = JSON.parse(fs.readFileSync("./"+network.name+". Upgrade PMX.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(bigDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await bigTimeLock.connect(impersonateAccount).executeBatch(...argsBig.slice(0, argsBig.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./"+network.name+". Upgrade PMX.json", JSON.stringify(argsBig, null, 2));
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
