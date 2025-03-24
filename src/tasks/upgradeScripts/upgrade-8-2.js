// SPDX-License-Identifier: BUSL-1.1
const { BigNumber } = require("ethers");
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
      utils: { parseEther, keccak256, toUtf8Bytes },
      constants: { HashZero },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { SMALL_TIMELOCK_ADMIN } = require("../../Constants.js");
  const { CurveOracleKind } = require("../../test/utils/constants");

  const { FeeRateType } = require("../../test/utils/constants");
  const { deployer } = await getNamedAccounts();

  const generalConfig = getConfigByName("generalConfig.json");
  const addresses = getConfigByName("addresses.json");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const Registry = await getContract("Registry");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactory");
  const PriceOracle = await getContract("PriceOracle");
  const PositionManager = await getContract("PositionManager");
  const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const TraderBalanceVault = await getContract("TraderBalanceVault");
  const TokenApproveLibrary = await getContract("TokenApproveLibrary");
  const DepositManager = await getContract("DepositManager");
  const SwapManager = await getContract("SwapManager");
  const BucketsFactoryV2 = await getContract("BucketsFactoryV2");
  const BatchManager = await getContract("BatchManager");
  const EPMXToken = await getContract("EPMXToken");
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

    const BucketExtension = await run("deploy:BucketExtension", {
      tokenTransfersLibrary: TokenTransfersLibrary.address,
      primexPricingLibrary: PrimexPricingLibrary.address,
      tokenApproveLibrary: TokenApproveLibrary.address,
    });

    const PositionManagerExtension = await run("deploy:PositionManagerExtension", {
      primexPricingLibrary: PrimexPricingLibrary.address,
      positionLibrary: PositionLibrary.address,
    });

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
     * NFT deploy
     */
    const baseURI = "";
    // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    const LendingPrimexNFT = await run("deploy:PrimexNFT", {
      deploymentName: "LendingPrimexNFT",
      implementationName: "PrimexNFT",
      registry: Registry.address,
      name: "Primex Lending Booster",
      symbol: "PLB",
      baseURI: baseURI,
    });

    const TradingPrimexNFT = await run("deploy:PrimexNFT", {
      deploymentName: "TradingPrimexNFT",
      implementationName: "PrimexNFT",
      registry: Registry.address,
      name: "Primex Trading Booster",
      symbol: "PTB",
      baseURI: baseURI,
    });

    const FarmingPrimexNFT = await run("deploy:PrimexNFT", {
      deploymentName: "FarmingPrimexNFT",
      implementationName: "PrimexNFT",
      registry: Registry.address,
      name: "Primex Farming Booster",
      symbol: "PFB",
      baseURI: baseURI,
    });

    // setup new ROLE
    const NFT_MINTER = keccak256(toUtf8Bytes("NFT_MINTER"));

    argsForBigTimeLock.targets.push(Registry.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setRoleAdmin", [NFT_MINTER, SMALL_TIMELOCK_ADMIN], "PrimexRegistry", Registry.address)).payload,
    );

    const TiersManagerConfig = generalConfig.TiersManagerConfig;
    /**
     * TiersManager deploy
     */
    const TiersManager = await run("deploy:TiersManager", {
      registry: Registry.address,
      traderBalanceVault: TraderBalanceVault.address,
      lendingNFT: LendingPrimexNFT.address,
      tradingNFT: TradingPrimexNFT.address,
      farmingNFT: FarmingPrimexNFT.address,
      earlyPmx: EPMXToken.address,
      tiers: JSON.stringify(Object.keys(TiersManagerConfig.tiers)),
      thresholds: JSON.stringify(Object.values(TiersManagerConfig.tiers)),
      notExecuteNewDeployedTasks: true,
    });

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

    // SETTING DM
    argsForBigTimeLock.targets.push(DepositManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setTiersManager", [TiersManager.address], "DepositManager", DepositManager.address)).payload,
    );

    argsForBigTimeLock.targets.push(DepositManager.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "setMagicTierCoefficient",
          [parseEther(generalConfig.DepositManagerMagicTierCoefficient)],
          "DepositManager",
          DepositManager.address,
        )
      ).payload,
    );

    const UniswapV2LPOracle = await run("deploy:UniswapV2LPOracle", {
      priceOracle: PriceOracle.address,
    });

    const CurveStableOracle = await run("deploy:CurveStableOracle", {
      registry: Registry.address,
      priceOracle: PriceOracle.address,
      curveAddressProvider: addresses.curveAddressProvider,
    });

    let algebraFactory;

    if (network.name === "polygon") {
      algebraFactory = addresses.dexes.quickswapv3.factory;
    }
    if (network.name === "arbitrumOne") {
      algebraFactory = addresses.dexes.camelotv3.factory;
    }

    if (algebraFactory) {
      await run("deploy:AlgebraPriceFeed", {
        algebraV3Factory: algebraFactory,
        twapInterval: generalConfig.twapInterval,
        registry: Registry.address,
      });
    }

    /**
     * PriceOracle upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PriceOracle.address,
      contractName: "PriceOracle",
      libraries: {},
      isBeacon: false,
    });

    // PriceOracle setting
    if (network.name !== "polygon") {
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setOrallyOracle", [addresses.orally], "PriceOracle", PriceOracle.address)).payload,
      );
    }

    // PriceOracle setting
    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setOrallyTimeTolerance", [generalConfig.orallyTimeTolerance], "PriceOracle", PriceOracle.address)).payload,
    );

    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "updateCurveTypeOracle",
          [[CurveOracleKind.STABLE], [CurveStableOracle.address]],
          "PriceOracle",
          PriceOracle.address,
        )
      ).payload,
    );

    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setUniswapV2LPOracle", [UniswapV2LPOracle.address], "PriceOracle", PriceOracle.address)).payload,
    );

    /**
     * SwapManager upgrade
     */

    await upgradeProxyWithCheck({
      proxyAddress: SwapManager.address,
      contractName: "SwapManager",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * TraderBalanceVault upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: TraderBalanceVault.address,
      contractName: "TraderBalanceVault",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    // TiersManager setting
    argsForBigTimeLock.targets.push(TiersManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("initializeAfterUpgrade", [TraderBalanceVault.address], "TiersManager", TiersManager.address)).payload,
    );

    /**
     * DNS upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PrimexDNS.address,
      contractName: "PrimexDNS",
      libraries: {},
      isBeacon: false,
    });

    // DNS setting
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setTiersManager", [TiersManager.address], "PrimexDNS", PrimexDNS.address)).payload,
    );

    const feeRateParams = [];

    const dnsConfig = generalConfig.PrimexDNSconfig;

    // push previous values for the zero tier
    for (const key in dnsConfig.feeRates["0"]) {
      const params = {
        feeRateType: FeeRateType[key],
        tier: 0,
        feeRate: await PrimexDNS.protocolFeeRates(FeeRateType[key]),
      };
      feeRateParams.push(params);
    }
    // sets only non-zero tier values
    for (const key in dnsConfig.feeRates) {
      if (key === "0") continue;
      for (const orderType in dnsConfig.feeRates[key]) {
        // check whether the key is the magic number
        const tier = isNaN(key) ? BigNumber.from(keccak256(toUtf8Bytes(key))).toString() : key;
        feeRateParams.push({
          feeRateType: FeeRateType[orderType],
          tier: tier,
          feeRate: parseEther(dnsConfig.feeRates[key][orderType]),
        });
      }
    }

    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setProtocolFeeRate", [feeRateParams], "PrimexDNS", PrimexDNS.address)).payload,
    );

    /**
     * PositionManager upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PositionManager.address,
      contractName: "PositionManager",
      libraries: {
        PositionLibrary: PositionLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    argsForBigTimeLock.targets.push(PositionManager.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "setPositionManagerExtension",
          [PositionManagerExtension.address],
          "PositionManager",
          PositionManager.address,
        )
      ).payload,
    );

    /**
     * ConditionalManagers deploy
     */
    const LimitPriceCOM = await deploy("LimitPriceCOM", {
      from: deployer,
      args: [Registry.address],
      log: true,
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        LimitOrderLibrary: LimitOrderLibrary.address,
      },
    });

    const TakeProfitStopLossCCM = await deploy("TakeProfitStopLossCCM", {
      from: deployer,
      args: [Registry.address],
      log: true,
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        PositionLibrary: PositionLibrary.address,
      },
    });

    argsForBigTimeLock.targets.push(LimitPriceCOM.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "initialize",
          [PrimexDNS.address, PriceOracle.address, PositionManager.address, KeeperRewardDistributor.address],
          "LimitPriceCOM",
          LimitPriceCOM.address,
        )
      ).payload,
    );

    argsForBigTimeLock.targets.push(TakeProfitStopLossCCM.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "initialize",
          [PrimexDNS.address, PriceOracle.address],
          "TakeProfitStopLossCCM",
          TakeProfitStopLossCCM.address,
        )
      ).payload,
    );

    // set conditional managers
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setConditionalManager", ["1", LimitPriceCOM.address], "PrimexDNS", PrimexDNS.address)).payload,
    );
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setConditionalManager", ["2", TakeProfitStopLossCCM.address], "PrimexDNS", PrimexDNS.address)).payload,
    );

    // set bucket extention
    const bucketsv1 = await BucketsFactory.allBuckets();
    const bucketsv2 = await BucketsFactoryV2.allBuckets();
    const buckets = [...bucketsv1, ...bucketsv2];

    for (let i = 0; i < buckets.length; i++) {
      argsForBigTimeLock.targets.push(buckets[i]);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setBucketExtension", [BucketExtension.address], "Bucket", buckets[i])).payload,
      );
    }

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

    /**
     * BatchManager upgrade
     */

    await upgradeProxyWithCheck({
      proxyAddress: BatchManager.address,
      contractName: "BatchManager",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        PositionLibrary: PositionLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * Redeploy upgrade
     */

    const OldDexAdapter = await getContract("DexAdapter");

    const DexAdapter = await deploy("DexAdapter", {
      from: deployer,
      args: [Registry.address, addresses.wrappedNativeToken],
      log: true,
      libraries: {
        TokenApproveLibrary: TokenApproveLibrary.address,
      },
    });

    addToWhiteList.push(DexAdapter.address);
    removeFromWhiteList.push(OldDexAdapter.address);

    const routers = [];
    const names = [];
    const dexTypes = [];
    const quoters = {};

    const dexes = addresses.dexes;

    for (const dex in dexes) {
      const dexName = dex;
      const dexRouter = dexes[dex].router;

      // Add data for all DEXes (both new and existing)
      names.push(dexName);
      dexTypes.push(dexes[dex].type);
      routers.push(dexRouter);
      if (dexes[dex].quoter !== undefined) {
        quoters[routers.length - 1] = dexes[dex].quoter;
      }
    }

    if (names.length !== routers.length) throw new Error("length of router addresses and the length of the names do not match");
    if (dexTypes.length !== routers.length) throw new Error("length of router addresses and the length of the dex types do not match");

    // set Primex DNS
    argsForBigTimeLock.targets.push(DexAdapter.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("initialize", [PrimexDNS.address], "DexAdapter", DexAdapter.address)).payload,
    );

    // set new dex adapter
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setDexAdapter", [DexAdapter.address], "PrimexDNS", PrimexDNS.address)).payload,
    );

    // Set dex types for all DEXes in DexAdapter
    for (let i = 0; i < names.length; i++) {
      argsForBigTimeLock.targets.push(DexAdapter.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setDexType", [routers[i], dexTypes[i]], "DexAdapter", DexAdapter.address)).payload,
      );
    }

    // set quoters
    if (quoters) {
      for (const key in quoters) {
        argsForBigTimeLock.targets.push(DexAdapter.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setQuoter", [routers[key], quoters[key]], "DexAdapter", DexAdapter.address)).payload,
        );
      }
    }

    /**
     * PrimexLens deploy
     */
    await run("deploy:PrimexLens", {
      primexPricingLibrary: PrimexPricingLibrary.address,
      positionLibrary: PositionLibrary.address,
      limitOrderLibrary: LimitOrderLibrary.address,
      takeProfitStopLossCCM: TakeProfitStopLossCCM.address,
    });

    /**
     * PrimexLensPart2 deploy
     */
    await run("deploy:PrimexLensPart2", {
      primexPricingLibrary: PrimexPricingLibrary.address,
    });

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
