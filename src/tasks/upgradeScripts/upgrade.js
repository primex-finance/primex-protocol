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
  const { getConfigByName, getAddress, getDecimals } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");

  const { OrderType, NATIVE_CURRENCY } = require("../../test/utils/constants");
  const { BATCH_MANAGER_ROLE, VAULT_ACCESS_ROLE, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN } = require("../../Constants.js");
  const { deployer } = await getNamedAccounts();

  // immutable
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const TraderBalanceVault = await getContract("TraderBalanceVault");
  const Registry = await getContract("Registry");
  const PriceOracle = await getContract("PriceOracle");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactory");
  const PositionManager = await getContract("PositionManager");
  const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const SpotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
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

  const { PrimexDNSconfig, PositionManagerConfig } = getConfigByName("generalConfig.json");

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

  const minPositionAsset = await getAddress(PositionManagerConfig.minPositionAsset);
  const minPositionSize = parseUnits(PositionManagerConfig.minPositionSize, await getDecimals(minPositionAsset));

  if (executeFromDeployer) {
    tx = await PositionManager.setMinPositionSize(minPositionSize, minPositionAsset);
    await tx.wait();
  } else {
    argsForBigTimeLock.targets.push(PositionManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setMinPositionSize", [minPositionSize, minPositionAsset], "PositionManager", PositionManager.address))
        .payload,
    );
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

  const oldSwapManager = await getContract("SwapManager");

  const newSwapManager = await deploy("SwapManager", {
    from: deployer,
    args: [Registry.address, PrimexDNS.address, TraderBalanceVault.address, PriceOracle.address, WhiteBlackList.address],
    log: true,
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      TokenTransfersLibrary: TokenTransfersLibrary.address,
    },
  });

  addToWhiteList.push(newSwapManager.address);
  removeFromWhiteList.push(oldSwapManager.address);

  if (executeFromDeployer) {
    tx = await Registry.grantRole(VAULT_ACCESS_ROLE, newSwapManager.address);
    await tx.wait();

    tx = await Registry.revokeRole(VAULT_ACCESS_ROLE, oldSwapManager.address);
    await tx.wait();

    tx = await LimitOrderManager.setSwapManager(newSwapManager.address);
    await tx.wait();
  } else {
    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, newSwapManager.address], "PrimexRegistry", Registry.address)).payload,
    );

    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("revokeRole", [VAULT_ACCESS_ROLE, oldSwapManager.address], "PrimexRegistry", Registry.address)).payload,
    );

    argsForBigTimeLock.targets.push(LimitOrderManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setSwapManager", [newSwapManager.address], "LimitOrderManager", LimitOrderManager.address)).payload,
    );
  }
  /**
   * BatchManager deploy
   */
  const oldBatchManager = await getContract("BatchManager");

  const newBatchManager = await deploy("BatchManager", {
    from: deployer,
    log: true,
    args: [PositionManager.address, PriceOracle.address, WhiteBlackList.address, Registry.address],
    libraries: {
      PrimexPricingLibrary: PrimexPricingLibrary.address,
      PositionLibrary: PositionLibrary.address,
    },
  });

  addToWhiteList.push(newBatchManager.address);
  removeFromWhiteList.push(oldBatchManager.address);

  if (executeFromDeployer) {
    tx = await Registry.grantRole(BATCH_MANAGER_ROLE, newBatchManager.address);
    await tx.wait();
    tx = await Registry.grantRole(VAULT_ACCESS_ROLE, newBatchManager.address);
    await tx.wait();

    // revoke rights
    tx = await Registry.revokeRole(BATCH_MANAGER_ROLE, oldBatchManager.address);
    await tx.wait();

    tx = await Registry.revokeRole(VAULT_ACCESS_ROLE, oldBatchManager.address);
    await tx.wait();
  } else {
    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [BATCH_MANAGER_ROLE, newBatchManager.address], "PrimexRegistry", Registry.address)).payload,
    );

    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, newBatchManager.address], "PrimexRegistry", Registry.address)).payload,
    );

    // revoke rights

    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("revokeRole", [BATCH_MANAGER_ROLE, oldBatchManager.address], "PrimexRegistry", Registry.address)).payload,
    );

    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("revokeRole", [VAULT_ACCESS_ROLE, oldBatchManager.address], "PrimexRegistry", Registry.address)).payload,
    );
  }

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
