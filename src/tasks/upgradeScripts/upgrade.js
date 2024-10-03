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
      getContractAt,
      getContractFactory,
      utils: { parseEther, parseUnits },
      constants: { HashZero, MaxUint256 },
    },
    upgrades,
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const { OrderType, NATIVE_CURRENCY } = require("../../test/utils/constants");
  const { MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN } = require("../../Constants.js");
  const { deployer } = await getNamedAccounts();

  // immutable
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const Registry = await getContract("Registry");
  const PriceOracle = await getContract("PriceOracle");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactoryV2");
  const PositionManager = await getContract("PositionManager");
  const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const SpotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
  const SwapManager = await getContract("SwapManager");
  const BatchManager = await getContract("BatchManager");
  const PMXToken = await getContract("EPMXToken");

  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const addToWhiteList = [];
  const removeFromWhiteList = [];

  // first order:
  const PrimexPricingLibrary = await run("deploy:PrimexPricingLibrary", {
    tokenTransfersLibrary: TokenTransfersLibrary.address,
  });

  const LimitOrderLibrary = await run("deploy:LimitOrderLibrary", {
    primexPricingLibrary: PrimexPricingLibrary.address,
    tokenTransfersLibrary: TokenTransfersLibrary.address,
  });

  const PositionLibrary = await run("deploy:PositionLibrary", {
    primexPricingLibrary: PrimexPricingLibrary.address,
    tokenTransfersLibrary: TokenTransfersLibrary.address,
    limitOrderLibrary: LimitOrderLibrary.address,
  });

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
   * DNS upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: PrimexDNS.address,
    contractName: "PrimexDNS",
    implArtifactName: "PrimexDNS_Implementation",
    libraries: {},
    isBeacon: false,
  });

  if (executeFromDeployer) {
    tx = await Registry.grantRole(MEDIUM_TIMELOCK_ADMIN, bigTimeLock.address);
    await tx.wait();

    tx = await Registry.grantRole(SMALL_TIMELOCK_ADMIN, bigTimeLock.address);
    await tx.wait();
  } else {
    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [MEDIUM_TIMELOCK_ADMIN, bigTimeLock.address], "PrimexRegistry", Registry.address)).payload,
    );

    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [SMALL_TIMELOCK_ADMIN, bigTimeLock.address], "PrimexRegistry", Registry.address)).payload,
    );
  }

  const { PrimexDNSconfig } = getConfigByName("generalConfig.json");

  const rates = [];
  const restrictions = [];

  for (const orderType in OrderType) {
    rates.push({
      orderType: OrderType[orderType],
      feeToken: PMXToken.address,
      rate: parseUnits(PrimexDNSconfig.rates[orderType].protocolRateInPmx, 18).toString(),
    });
    rates.push({
      orderType: OrderType[orderType],
      feeToken: NATIVE_CURRENCY,
      rate: parseUnits(PrimexDNSconfig.rates[orderType].protocolRate, 18).toString(),
    });
    const minProtocolFee = PrimexDNSconfig.feeRestrictions[orderType].minProtocolFee;
    const maxProtocolFee = PrimexDNSconfig.feeRestrictions[orderType].maxProtocolFee;
    const orderRestrictions = {
      minProtocolFee: (minProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(minProtocolFee)).toString(),
      maxProtocolFee: (maxProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(maxProtocolFee)).toString(),
    };
    restrictions.push({ orderType: OrderType[orderType], orderRestrictions: orderRestrictions });
  }

  if (executeFromDeployer) {
    for (const restriction of restrictions) {
      tx = await PrimexDNS.setFeeRestrictions(restriction.orderType, restriction.orderRestrictions);
      await tx.wait();
    }
    for (const rate of rates) {
      tx = await PrimexDNS.setFeeRate(rate);
      await tx.wait();
    }
  } else {
    for (const restriction of restrictions) {
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setFeeRestrictions",
            [restriction.orderType, restriction.orderRestrictions],
            "PrimexDNS",
            PrimexDNS.address,
          )
        ).payload,
      );
    }
    for (const rate of rates) {
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push((await encodeFunctionData("setFeeRate", [rate], "PrimexDNS", PrimexDNS.address)).payload);
    }
  }

  /**
   * Bucket upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: BucketsFactory.address,
    contractName: "Bucket",
    implArtifactName: "Bucket",
    libraries: {
      TokenTransfersLibrary: TokenTransfersLibrary.address,
    },
    isBeacon: true,
  });

  /**
   * PositionManager upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: PositionManager.address,
    contractName: "PositionManager",
    implArtifactName: "PositionManager_Implementation",
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      PositionLibrary: PositionLibrary.address,
      TokenTransfersLibrary: TokenTransfersLibrary.address,
    },
    isBeacon: false,
  });

  /**
   * KeeperRewardDistributor upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: KeeperRewardDistributor.address,
    contractName: "KeeperRewardDistributor",
    implArtifactName: "KeeperRewardDistributor_Implementation",
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
    },
    isBeacon: false,
  });

  /**
   * LimitOrderManager upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: LimitOrderManager.address,
    contractName: "LimitOrderManager",
    implArtifactName: "LimitOrderManager_Implementation",
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      LimitOrderLibrary: LimitOrderLibrary.address,
    },
    isBeacon: false,
  });

  /**
   * SpotTradingRewardDistributor upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: SpotTradingRewardDistributor.address,
    contractName: "SpotTradingRewardDistributor",
    implArtifactName: "SpotTradingRewardDistributor_Implementation",
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
    },
    isBeacon: false,
  });

  /**
   * SwapManager upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: SwapManager.address,
    contractName: "SwapManager",
    implArtifactName: "SwapManager_Implementation",
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      TokenTransfersLibrary: TokenTransfersLibrary.address,
    },
    isBeacon: false,
  });

  /**
   * SwapManager upgrade
   */
  await upgradeProxyWithCheck({
    proxyAddress: BatchManager.address,
    contractName: "BatchManager",
    implArtifactName: "BatchManager_Implementation",
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      PositionLibrary: PositionLibrary.address,
    },
    isBeacon: false,
  });

  /**
   * ConditionalManagers deploy
   */
  const limitPriceCOM = await deploy("LimitPriceCOM", {
    from: deployer,
    args: [PrimexDNS.address, PriceOracle.address, PositionManager.address],
    log: true,
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      LimitOrderLibrary: LimitOrderLibrary.address,
    },
  });

  const takeProfitStopLossCCM = await deploy("TakeProfitStopLossCCM", {
    from: deployer,
    args: [PrimexDNS.address, PriceOracle.address],
    log: true,
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      PositionLibrary: PositionLibrary.address,
    },
  });

  if (executeFromDeployer) {
    tx = await PrimexDNS.setConditionalManager("1", limitPriceCOM.address);
    await tx.wait();

    tx = await PrimexDNS.setConditionalManager("2", takeProfitStopLossCCM.address);
    await tx.wait();
  } else {
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setConditionalManager", ["1", limitPriceCOM.address], "PrimexDNS", PrimexDNS.address)).payload,
    );

    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setConditionalManager", ["2", takeProfitStopLossCCM.address], "PrimexDNS", PrimexDNS.address)).payload,
    );
  }

  /**
   * BestDexLens deploy
   */
  const BestDexLens = await run("deploy:BestDexLens", {
    primexPricingLibrary: PrimexPricingLibrary.address,
  });

  /**
   * PrimexLens deploy
   */
  const PrimexLens = await run("deploy:PrimexLens", {
    primexPricingLibrary: PrimexPricingLibrary.address,
    positionLibrary: PositionLibrary.address,
    limitOrderLibrary: LimitOrderLibrary.address,
    takeProfitStopLossCCM: takeProfitStopLossCCM.address,
  });

  /**
   * PrimexUpkeep deploy
   */
  const oldPrimexUpkeep = await getContract("PrimexUpkeep");

  const primexUpkeep = await deploy("PrimexUpkeep", {
    from: deployer,
    args: [PositionManager.address, LimitOrderManager.address, Registry.address, BestDexLens.address, PrimexLens.address],
    log: true,
  });

  addToWhiteList.push(primexUpkeep.address);
  removeFromWhiteList.push(oldPrimexUpkeep.address);

  if (executeFromDeployer) {
    tx = await WhiteBlackList.addAddressesToWhitelist(addToWhiteList);
    await tx.wait();
    tx = await WhiteBlackList.removeAddressesFromWhitelist(removeFromWhiteList);
    await tx.wait();
  } else {
    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addAddressesToWhitelist", [addToWhiteList], "WhiteBlackList", WhiteBlackList.address)).payload,
    );

    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("removeAddressesFromWhitelist", [removeFromWhiteList], "WhiteBlackList", WhiteBlackList.address)).payload,
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
