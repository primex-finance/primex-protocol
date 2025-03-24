// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const path = require("path");
module.exports = async function (
  { executeUpgrade, executeFromDeployer, isFork },
  {
    run,
    network,
    getNamedAccounts,
    deployments: { deploy, get, getArtifact },
    ethers: {
      getContract,
      providers,
      getContractAt,
      getContractFactory,
      constants: { HashZero },
      utils: { defaultAbiCoder, parseUnits },
    },
    upgrades,
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { BAR_CALC_PARAMS_DECODE, USD_DECIMALS } = require("../../test/utils/constants.js");

  const { networks } = require("../../hardhat.config.js");

  const { deployer } = await getNamedAccounts();

  const generalConfig = getConfigByName("generalConfig.json");
  const addresses = getConfigByName("addresses.json");

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const Registry = await getContract("Registry");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactory");
  const BucketsFactoryV2 = await getContract("BucketsFactoryV2");
  const PTokensFactory = await getContract("PTokensFactory");
  const PriceOracle = await getContract("PriceOracle");
  const DebtTokensFactory = await getContract("DebtTokensFactory");
  const PositionManager = await getContract("PositionManager");
  const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const SpotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
  const Reserve = await getContract("Reserve");
  const ActivityRewardDistributor = await getContract("ActivityRewardDistributor");
  const LiquidityMiningRewardDistributor = await getContract("LiquidityMiningRewardDistributor");
  const TraderBalanceVault = await getContract("TraderBalanceVault");
  const FlashLoanManager = await getContract("FlashLoanManager");
  const SwapManager = await getContract("SwapManager");
  const BatchManager = await getContract("BatchManager");
  const ReferralProgram = await getContract("ReferralProgram");
  const Treasury = await getContract("Treasury");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x8ac7230489e80000"]);
  }

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
        await tx.wait();
      } else {
        tx = await PrimexProxyAdmin.upgrade(proxyAddress, NewImplementation.address);
        await tx.wait();
      }
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
    // first order:
    const TokenTransfersLibrary = await run("deploy:TokenTransfersLibrary");

    const TokenApproveLibrary = await run("deploy:TokenApproveLibrary", {
      tokenTransfersLibrary: TokenTransfersLibrary.address,
    });
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
    await upgradeProxyWithoutCheck({
      proxyAddress: KeeperRewardDistributor.address,
      contractName: "KeeperRewardDistributor",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
      },
      isBeacon: false,
    });
    /**
     * UniswapPriceFeed deploy
     */
    const UniswapPriceFeed = await run("deploy:UniswapPriceFeed", {
      registry: Registry.address,
      uniswapV3Factory: addresses.dexes.uniswapv3.factory,
      poolUpdateInterval: generalConfig.poolUpdateInterval,
      twapInterval: generalConfig.twapInterval,
    });

    const price = parseUnits(generalConfig.EPMXOraclePrice, USD_DECIMALS);

    let EPMXPriceFeed = await run("deploy:EPMXPriceFeed", {
      registry: Registry.address,
    });

    EPMXPriceFeed = await getContractAt("EPMXPriceFeed", EPMXPriceFeed.address);

    const EPMXToken = await getContract("EPMXToken");
    const priceFeeds = { tokens: [EPMXToken.address], feeds: [EPMXPriceFeed.address] };

    if (executeFromDeployer) {
      tx = await PriceOracle.updateChainlinkPriceFeedsUsd(priceFeeds.tokens, priceFeeds.feeds);
      await tx.wait();

      tx = await EPMXPriceFeed.setAnswer(price.toString());
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(EPMXPriceFeed.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setAnswer", [price.toString()], "EPMXPriceFeed", EPMXPriceFeed.address)).payload,
      );

      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "updateChainlinkPriceFeedsUsd",
            [priceFeeds.tokens, priceFeeds.feeds],
            "PriceOracle",
            PriceOracle.address,
          )
        ).payload,
      );
    }

    /**
     * PriceOracle upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: PriceOracle.address,
      contractName: "PriceOracle",
      libraries: {},
      isBeacon: false,
    });

    if (executeFromDeployer) {
      tx = await PriceOracle.updateUniv3TypeOracle([0], [UniswapPriceFeed.address]);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("updateUniv3TypeOracle", [[0], [UniswapPriceFeed.address]], "PriceOracle", PriceOracle.address)).payload,
      );
    }
    if (network.name === "arbitrumFork" || network.name === "arbitrumOne") {
      const GasPriceOracleArbitrumOne = await run("deploy:GasPriceOracleArbitrumOne", {});
      if (executeFromDeployer) {
        tx = await PriceOracle.setGasPriceFeed(GasPriceOracleArbitrumOne.address);
        await tx.wait();
      } else {
        argsForBigTimeLock.targets.push(PriceOracle.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setGasPriceFeed", [GasPriceOracleArbitrumOne.address], "PriceOracle", PriceOracle.address)).payload,
        );
      }
    }

    /**
     * DNS upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: PrimexDNS.address,
      contractName: "PrimexDNS",
      libraries: {},
      isBeacon: false,
    });

    /**
     * WhiteBlackList upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: WhiteBlackList.address,
      contractName: "WhiteBlackList",
      libraries: {},
      isBeacon: false,
    });

    /**
     * PositionManager upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: PositionManager.address,
      contractName: "PositionManager",
      libraries: {
        PositionLibrary: PositionLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    // set PositionManager extention
    if (executeFromDeployer) {
      tx = await PositionManager.setPositionManagerExtension(PositionManagerExtension.address);
      await tx.wait();
    } else {
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
    }

    /**
     * ConditionalManagers deploy
     */
    let LimitPriceCOM = await deploy("LimitPriceCOM", {
      from: deployer,
      args: [Registry.address],
      log: true,
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        LimitOrderLibrary: LimitOrderLibrary.address,
      },
    });

    LimitPriceCOM = await getContractAt("LimitPriceCOM", LimitPriceCOM.address);

    let TakeProfitStopLossCCM = await deploy("TakeProfitStopLossCCM", {
      from: deployer,
      args: [Registry.address],
      log: true,
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        PositionLibrary: PositionLibrary.address,
      },
    });

    TakeProfitStopLossCCM = await getContractAt("TakeProfitStopLossCCM", TakeProfitStopLossCCM.address);

    // ConditionalManagers initialize
    if (executeFromDeployer) {
      tx = await LimitPriceCOM.initialize(PrimexDNS.address, PriceOracle.address, PositionManager.address, KeeperRewardDistributor.address);
      await tx.wait();

      tx = await TakeProfitStopLossCCM.initialize(PrimexDNS.address, PriceOracle.address);
      await tx.wait();
    } else {
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
    }

    if (executeFromDeployer) {
      // set conditional managers
      tx = await PrimexDNS.setConditionalManager("1", LimitPriceCOM.address);
      await tx.wait();

      tx = await PrimexDNS.setConditionalManager("2", TakeProfitStopLossCCM.address);
      await tx.wait();
    } else {
      // set conditional managers
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setConditionalManager", ["1", LimitPriceCOM.address], "PrimexDNS", PrimexDNS.address)).payload,
      );
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setConditionalManager", ["2", TakeProfitStopLossCCM.address], "PrimexDNS", PrimexDNS.address)).payload,
      );
    }

    /**
     * FlashLoanManager upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: FlashLoanManager.address,
      contractName: "FlashLoanManager",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * Bucket upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: BucketsFactory.address,
      contractName: "Bucket",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
        TokenApproveLibrary: TokenApproveLibrary.address,
      },
      isBeacon: true,
    });

    await upgradeProxyWithoutCheck({
      proxyAddress: BucketsFactoryV2.address,
      contractName: "Bucket",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
        TokenApproveLibrary: TokenApproveLibrary.address,
      },
      isBeacon: true,
    });

    const OldInterestRateStrategy = await getContract("InterestRateStrategy");

    const InterestRateStrategy = await run("deploy:InterestRateStrategy");

    // set bucket extention
    const buckets1 = await BucketsFactory.allBuckets();
    const buckets2 = await BucketsFactoryV2.allBuckets();
    const buckets = [...buckets1, ...buckets2];

    if (executeFromDeployer) {
      for (let i = 0; i < buckets.length; i++) {
        const bucket = await getContractAt("Bucket", buckets[i]);
        tx = await bucket.setBucketExtension(BucketExtension.address);
        await tx.wait();

        tx = await bucket.setInterestRateStrategy(InterestRateStrategy.address);
        await tx.wait();

        let barParams = await OldInterestRateStrategy.getBarCalculationParams(buckets[i]);
        barParams = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [
          [barParams.urOptimal, barParams.k0, barParams.k1, barParams.b0, barParams.b1],
        ]);

        tx = await bucket.setBarCalculationParams(barParams);
        await tx.wait();
      }
    } else {
      // set bucket extention
      for (let i = 0; i < buckets.length; i++) {
        argsForBigTimeLock.targets.push(buckets[i]);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setBucketExtension", [BucketExtension.address], "Bucket", buckets[i])).payload,
        );

        argsForBigTimeLock.targets.push(buckets[i]);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setInterestRateStrategy", [InterestRateStrategy.address], "Bucket", buckets[i])).payload,
        );

        let barParams = await OldInterestRateStrategy.getBarCalculationParams(buckets[i]);
        barParams = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [
          [barParams.urOptimal, barParams.k0, barParams.k1, barParams.b0, barParams.b1],
        ]);

        argsForBigTimeLock.targets.push(buckets[i]);
        argsForBigTimeLock.payloads.push((await encodeFunctionData("setBarCalculationParams", [barParams], "Bucket", buckets[i])).payload);
      }
    }

    /**
     * P-Token upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: PTokensFactory.address,
      contractName: "PToken",
      libraries: {},
      isBeacon: true,
    });

    /**
     * Debt-Token upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: DebtTokensFactory.address,
      contractName: "DebtToken",
      libraries: {},
      isBeacon: true,
    });

    /**
     * LimitOrderManager upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: LimitOrderManager.address,
      contractName: "LimitOrderManager",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        LimitOrderLibrary: LimitOrderLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * SpotTradingRewardDistributor upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: SpotTradingRewardDistributor.address,
      contractName: "SpotTradingRewardDistributor",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * ActivityRewardDistributor upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: ActivityRewardDistributor.address,
      contractName: "ActivityRewardDistributor",
      libraries: {},
      isBeacon: false,
    });

    /**
     * LiquidityMiningRewardDistributor upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: LiquidityMiningRewardDistributor.address,
      contractName: "LiquidityMiningRewardDistributor",
      libraries: {},
      isBeacon: false,
    });

    /**
     * Reserve upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: Reserve.address,
      contractName: "Reserve",
      libraries: {},
      isBeacon: false,
    });

    /**
     * ReferralProgram upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: ReferralProgram.address,
      contractName: "ReferralProgram",
      libraries: {},
      isBeacon: false,
    });

    /**
     * TraderBalanceVault upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: TraderBalanceVault.address,
      contractName: "TraderBalanceVault",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * Treasury upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: Treasury.address,
      contractName: "Treasury",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * SwapManager upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: SwapManager.address,
      contractName: "SwapManager",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    /**
     * BatchManager upgrade
     */
    await upgradeProxyWithoutCheck({
      proxyAddress: BatchManager.address,
      contractName: "BatchManager",
      libraries: {
        PositionLibrary: PositionLibrary.address,
        PrimexPricingLibrary: PrimexPricingLibrary.address,
        TokenTransfersLibrary: TokenTransfersLibrary.address,
      },
      isBeacon: false,
    });

    const OldDexAdapter = await getContract("DexAdapter");

    let DexAdapter = await deploy("DexAdapter", {
      from: deployer,
      args: [Registry.address, addresses.wrappedNativeToken],
      log: true,
      libraries: {
        TokenApproveLibrary: TokenApproveLibrary.address,
      },
    });
    DexAdapter = await getContractAt("DexAdapter", DexAdapter.address);

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

    if (executeFromDeployer) {
      tx = await DexAdapter.initialize(PrimexDNS.address);
      await tx.wait();

      // set new dex adapter
      tx = await PrimexDNS.setDexAdapter(DexAdapter.address);
      await tx.wait();

      // Set dex types for all DEXes in DexAdapter
      for (let i = 0; i < names.length; i++) {
        tx = await DexAdapter.setDexType(routers[i], dexTypes[i]);
        await tx.wait();
      }

      // set quoters
      if (quoters) {
        for (const key in quoters) {
          const tx = await DexAdapter.setQuoter(routers[key], quoters[key]);
          await tx.wait();
        }
      }
    } else {
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
    }

    /**
     * BestDexLens deploy
     */
    let BestDexLens;
    if (network.name === "arbitrumFork" || network.name === "arbitrumOne") {
      const BestDexLensFactory = await getContractFactory("BestDexLens", {
        libraries: {
          PrimexPricingLibrary: PrimexPricingLibrary.address,
        },
      });
      BestDexLens = await BestDexLensFactory.deploy();
      const receipt = await BestDexLens.deployTransaction.wait();
      const artifacts = await getArtifact("BestDexLens");
      // Save to deployments folder address and ABI
      const deploymentData = {
        address: BestDexLens.address,
        abi: artifacts.abi,
        receipt: receipt,
        transactionHash: BestDexLens.deployTransaction.hash,
        bytecode: BestDexLensFactory.bytecode,
        deployedBytecode: BestDexLensFactory.deployedBytecode,
        libraries: {
          PrimexPricingLibrary: PrimexPricingLibrary.address,
        },
        args: BestDexLens.deployTransaction.args,
      };

      let deploymentsDir;
      if (network.name === "arbitrumFork") deploymentsDir = path.resolve(__dirname, "../../deployments/arbitrumFork/BestDexLens.json");
      else deploymentsDir = path.resolve(__dirname, "../../deployments/arbitrumOne/BestDexLens.json");
      fs.writeFileSync(`${deploymentsDir}`, JSON.stringify(deploymentData, null, 2));
    } else {
      BestDexLens = await run("deploy:BestDexLens", {
        primexPricingLibrary: PrimexPricingLibrary.address,
      });
    }

    /**
     * PrimexLens deploy
     */
    const PrimexLens = await run("deploy:PrimexLens", {
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

    /**
     * PrimexUpkeep deploy
     */
    const oldPrimexUpkeep = await getContract("PrimexUpkeep");

    let primexUpkeep = await deploy("PrimexUpkeep", {
      from: deployer,
      args: [Registry.address],
      log: true,
    });

    primexUpkeep = await getContractAt("PrimexUpkeep", primexUpkeep.address);

    if (executeFromDeployer) {
      tx = await primexUpkeep.initialize(PositionManager.address, LimitOrderManager.address, BestDexLens.address, PrimexLens.address);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(primexUpkeep.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "initialize",
            [PositionManager.address, LimitOrderManager.address, BestDexLens.address, PrimexLens.address],
            "PrimexUpkeep",
            primexUpkeep.address,
          )
        ).payload,
      );
    }

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
  }
};
