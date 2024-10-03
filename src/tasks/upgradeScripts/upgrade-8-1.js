// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const path = require("path");
module.exports = async function (
  { executeUpgrade, executeFromDeployer },
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
      utils: { parseEther, parseUnits, keccak256, toUtf8Bytes },
      constants: { HashZero, MaxUint256 },
    },
    upgrades,
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { SMALL_TIMELOCK_ADMIN, NO_FEE_ROLE } = require("../../Constants.js");

  const {
    TradingOrderType,
    FeeRateType,
    CallingMethod,
    NATIVE_CURRENCY,
    KeeperActionType,
    KeeperCallingMethod,
    DecreasingReason,
  } = require("../../test/utils/constants");
  const { deployer } = await getNamedAccounts();

  const generalConfig = getConfigByName("generalConfig.json");
  const addresses = getConfigByName("addresses.json");

  const timeTolerance = generalConfig.timeTolerance;

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const Registry = await getContract("Registry");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactory");
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
  const Treasury = await getContract("Treasury");
  const EPMXToken = await getContract("EPMXToken");
  const EPMXPriceFeed = await getContract("EPMXPriceFeed");
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
    // first order:
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
    await upgradeProxyWithCheck({
      proxyAddress: KeeperRewardDistributor.address,
      contractName: "KeeperRewardDistributor",
      libraries: {
        PrimexPricingLibrary: PrimexPricingLibrary.address,
      },
      isBeacon: false,
    });

    // set gas parameters

    const keeperRewardDistributorConfig = generalConfig.KeeperRewardConfig;
    const paymentModel = keeperRewardDistributorConfig.paymentModel;
    const maxGasPerPositionParams = [];
    const decreasingGasByReasonParams = [];
    const dataLengthRestrictions = [];

    for (const actionType in KeeperActionType) {
      maxGasPerPositionParams.push({
        actionType: KeeperActionType[actionType],
        config: keeperRewardDistributorConfig.maxGasPerPositionParams[actionType],
      });
    }

    for (const reason in DecreasingReason) {
      decreasingGasByReasonParams.push({
        reason: DecreasingReason[reason],
        amount: keeperRewardDistributorConfig.decreasingGasByReasonParams[reason],
      });
    }
    if (paymentModel === "ARBITRUM" || paymentModel === "OPTIMISTIC") {
      for (const callingMethod in KeeperCallingMethod) {
        dataLengthRestrictions.push({
          callingMethod: KeeperCallingMethod[callingMethod],
          maxRoutesLength: keeperRewardDistributorConfig.dataLengthRestrictions[callingMethod].maxRoutesLength,
          baseLength: keeperRewardDistributorConfig.dataLengthRestrictions[callingMethod].baseLength,
        });
      }
    }
    const positionSizeCoefficient = parseUnits(keeperRewardDistributorConfig.positionSizeCoefficient, 18).toString();
    const minPositionSizeAddend = parseEther(keeperRewardDistributorConfig.minPositionSizeAddend).toString();
    if (executeFromDeployer) {
      tx = await KeeperRewardDistributor.setAdditionalGas(keeperRewardDistributorConfig.additionalGas);
      await tx.wait();

      tx = await KeeperRewardDistributor.setOracleGasPriceTolerance(
        parseUnits(keeperRewardDistributorConfig.oracleGasPriceTolerance, 18).toString(),
      );
      await tx.wait();

      for (let i = 0; i < maxGasPerPositionParams.length; i++) {
        tx = await KeeperRewardDistributor.setMaxGasPerPosition(maxGasPerPositionParams[i].actionType, maxGasPerPositionParams[i].config);
        await tx.wait();
      }

      for (let i = 0; i < decreasingGasByReasonParams.length; i++) {
        tx = await KeeperRewardDistributor.setDecreasingGasByReason(
          decreasingGasByReasonParams[i].reason,
          decreasingGasByReasonParams[i].amount,
        );
        await tx.wait();
      }
      if (paymentModel === "ARBITRUM" || paymentModel === "OPTIMISTIC") {
        for (let i = 0; i < dataLengthRestrictions.length; i++) {
          tx = await KeeperRewardDistributor.setDataLengthRestrictions(
            dataLengthRestrictions[i].callingMethod,
            dataLengthRestrictions[i].maxRoutesLength,
            dataLengthRestrictions[i].baseLength,
          );
          await tx.wait();
        }
      }

      tx = await KeeperRewardDistributor.setPositionSizeCoefficient(positionSizeCoefficient);
      await tx.wait();

      tx = await KeeperRewardDistributor.setMinPositionSizeAddend(minPositionSizeAddend);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setAdditionalGas",
            [keeperRewardDistributorConfig.additionalGas],
            "KeeperRewardDistributor",
            KeeperRewardDistributor.address,
          )
        ).payload,
      );

      argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setOracleGasPriceTolerance",
            [parseUnits(keeperRewardDistributorConfig.oracleGasPriceTolerance, 18).toString()],
            "KeeperRewardDistributor",
            KeeperRewardDistributor.address,
          )
        ).payload,
      );

      for (let i = 0; i < maxGasPerPositionParams.length; i++) {
        argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
        argsForBigTimeLock.payloads.push(
          (
            await encodeFunctionData(
              "setMaxGasPerPosition",
              [maxGasPerPositionParams[i].actionType, maxGasPerPositionParams[i].config],
              "KeeperRewardDistributor",
              KeeperRewardDistributor.address,
            )
          ).payload,
        );
      }

      for (let i = 0; i < decreasingGasByReasonParams.length; i++) {
        argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
        argsForBigTimeLock.payloads.push(
          (
            await encodeFunctionData(
              "setDecreasingGasByReason",
              [decreasingGasByReasonParams[i].reason, decreasingGasByReasonParams[i].amount],
              "KeeperRewardDistributor",
              KeeperRewardDistributor.address,
            )
          ).payload,
        );
      }
      if (paymentModel === "ARBITRUM" || paymentModel === "OPTIMISTIC") {
        for (let i = 0; i < dataLengthRestrictions.length; i++) {
          argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
          argsForBigTimeLock.payloads.push(
            (
              await encodeFunctionData(
                "setDataLengthRestrictions",
                [dataLengthRestrictions[i].callingMethod, dataLengthRestrictions[i].maxRoutesLength, dataLengthRestrictions[i].baseLength],
                "KeeperRewardDistributor",
                KeeperRewardDistributor.address,
              )
            ).payload,
          );
        }
      }

      // Set new positionSizeCoefficient
      argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setPositionSizeCoefficient",
            [positionSizeCoefficient],
            "KeeperRewardDistributor",
            KeeperRewardDistributor.address,
          )
        ).payload,
      );

      // Set new minPositionSizeAddend
      argsForBigTimeLock.targets.push(KeeperRewardDistributor.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setMinPositionSizeAddend",
            [minPositionSizeAddend],
            "KeeperRewardDistributor",
            KeeperRewardDistributor.address,
          )
        ).payload,
      );
    }

    const UniswapPriceFeed = await run("deploy:UniswapPriceFeed", {
      registry: Registry.address,
      uniswapV3Factory: addresses.dexes.uniswapv3.factory,
      poolUpdateInterval: generalConfig.poolUpdateInterval,
      twapInterval: generalConfig.twapInterval,
    });

    /**
     * PriceOracle upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PriceOracle.address,
      contractName: "PriceOracle",
      libraries: {},
      isBeacon: false,
    });

    const pythPriceFeedsIds = getConfigByName("pythPriceFeedsIds.json");

    const tokensForPyth = [];
    const pythFeedIds = [];

    for (const key in pythPriceFeedsIds) {
      if (key === "matic" && network.name === "polygon") {
        tokensForPyth.push(NATIVE_CURRENCY);
        pythFeedIds.push(pythPriceFeedsIds[key]);
        continue;
      }
      if (key === "eth" && (network.name === "ethereum" || network.name === "arbitrumOne")) {
        tokensForPyth.push(NATIVE_CURRENCY);
        pythFeedIds.push(pythPriceFeedsIds[key]);
        continue;
      }
      if (addresses.assets[key]) {
        tokensForPyth.push(addresses.assets[key]);
        pythFeedIds.push(pythPriceFeedsIds[key]);
      }
    }

    const tokensForChainLink = [];
    const chainLinkPriceFeeds = [];

    tokensForChainLink.push(EPMXToken.address);
    chainLinkPriceFeeds.push(EPMXPriceFeed.address);

    for (const key in addresses.pricefeeds) {
      if (key === "selfDeployed") {
        continue;
      }
      const feedAssets = key.split("-");
      if (feedAssets[0] === "native") {
        tokensForChainLink.push(NATIVE_CURRENCY);
      } else {
        tokensForChainLink.push(addresses.assets[feedAssets[0]]);
      }
      chainLinkPriceFeeds.push(addresses.pricefeeds[key]);
    }
    let gasPriceFeedArbitrumOne;
    if (paymentModel === "ARBITRUM") {
      gasPriceFeedArbitrumOne = await run("deploy:GasPriceOracleArbitrumOne");
    }

    if (executeFromDeployer) {
      // set usdt
      if (addresses.assets.usdt) {
        tx = await PriceOracle.setUSDT(addresses.assets.usdt);
        await tx.wait();
      }

      tx = await PriceOracle.updateUniv3TypeOracle([0], [UniswapPriceFeed.address]);
      await tx.wait();

      tx = await PriceOracle.setPyth(addresses.pyth);
      await tx.wait();

      if (addresses.supraPullOracle) {
        tx = await PriceOracle.setSupraPullOracle(addresses.supraPullOracle);
        await tx.wait();

        tx = await PriceOracle.setSupraStorageOracle(addresses.supraStorageOracle);
        await tx.wait();
      }

      tx = await PriceOracle.setTimeTolerance(timeTolerance);
      await tx.wait();

      tx = await PriceOracle.updatePythPairId(tokensForPyth, pythFeedIds);
      await tx.wait();

      tx = await PriceOracle.updateChainlinkPriceFeedsUsd(tokensForChainLink, chainLinkPriceFeeds);
      await tx.wait();

      tx = await PriceOracle.setTreasury(Treasury.address);
      await tx.wait();

      if (paymentModel === "ARBITRUM") {
        tx = await PriceOracle.setGasPriceFeed(gasPriceFeedArbitrumOne.address);
      }
    } else {
      // set usdt
      if (addresses.assets.usdt) {
        argsForBigTimeLock.targets.push(PriceOracle.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setUSDT", [addresses.assets.usdt], "PriceOracle", PriceOracle.address)).payload,
        );
      }
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("updateUniv3TypeOracle", [[0], [UniswapPriceFeed.address]], "PriceOracle", PriceOracle.address)).payload,
      );
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push((await encodeFunctionData("setPyth", [addresses.pyth], "PriceOracle", PriceOracle.address)).payload);

      if (addresses.supraPullOracle) {
        argsForBigTimeLock.targets.push(PriceOracle.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setSupraPullOracle", [addresses.supraPullOracle], "PriceOracle", PriceOracle.address)).payload,
        );

        argsForBigTimeLock.targets.push(PriceOracle.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setSupraStorageOracle", [addresses.supraStorageOracle], "PriceOracle", PriceOracle.address)).payload,
        );
      }
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setTimeTolerance", [timeTolerance], "PriceOracle", PriceOracle.address)).payload,
      );

      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("updatePythPairId", [tokensForPyth, pythFeedIds], "PriceOracle", PriceOracle.address)).payload,
      );

      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "updateChainlinkPriceFeedsUsd",
            [tokensForChainLink, chainLinkPriceFeeds],
            "PriceOracle",
            PriceOracle.address,
          )
        ).payload,
      );
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setTreasury", [Treasury.address], "PriceOracle", PriceOracle.address)).payload,
      );
      if (paymentModel === "ARBITRUM") {
        argsForBigTimeLock.targets.push(PriceOracle.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setGasPriceFeed", [gasPriceFeedArbitrumOne.address], "PriceOracle", PriceOracle.address)).payload,
        );
      }
    }

    /**
     * DNS upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PrimexDNS.address,
      contractName: "PrimexDNS",
      libraries: {},
      isBeacon: false,
    });

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

    // set bucket extention
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

    // ConditionalManagers initialize
    if (executeFromDeployer) {
      await LimitPriceCOM.initialize(PrimexDNS.address, PriceOracle.address, PositionManager.address, KeeperRewardDistributor.address);

      await TakeProfitStopLossCCM.initialize(PrimexDNS.address, PriceOracle.address);
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

    const dnsConfig = generalConfig.PrimexDNSconfig;

    if (executeFromDeployer) {
      // max protocol fee
      tx = await PrimexDNS.setMaxProtocolFee(dnsConfig.maxProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(dnsConfig.maxProtocolFee));
      await tx.wait();

      // leverage tolerance
      tx = await PrimexDNS.setLeverageTolerance(parseEther(dnsConfig.leverageTolerance));
      await tx.wait();

      // protocol fee coefficient
      tx = await PrimexDNS.setProtocolFeeCoefficient(parseEther(dnsConfig.protocolFeeCoefficient));
      await tx.wait();

      // liquidation gas amount
      tx = await PrimexDNS.setLiquidationGasAmount(dnsConfig.liquidationGasAmount);
      await tx.wait();

      // pmx discount account
      tx = await PrimexDNS.setPmxDiscountMultiplier(parseEther(dnsConfig.pmxDiscountMultiplier));
      await tx.wait();

      // gas price buffer
      tx = await PrimexDNS.setGasPriceBuffer(parseEther(dnsConfig.gasPriceBuffer));
      await tx.wait();

      // additional gas spent
      tx = await PrimexDNS.setAdditionalGasSpent(dnsConfig.additionalGasSpent);
      await tx.wait();

      // fee rates
      for (const key in dnsConfig.feeRates) {
        const params = {
          orderType: FeeRateType[key],
          rate: parseEther(dnsConfig.feeRates[key]),
        };
        tx = await PrimexDNS.setProtocolFeeRate(params);
        await tx.wait();
      }

      // average gas per action
      for (const key in dnsConfig.averageGasPerAction) {
        const params = {
          tradingOrderType: TradingOrderType[key],
          averageGasPerAction: dnsConfig.averageGasPerAction[key],
        };
        tx = await PrimexDNS.setAverageGasPerAction(params);
        await tx.wait();
      }

      // min fee restrictions
      for (const key in dnsConfig.minFeeRestrictions) {
        tx = await PrimexDNS.setMinFeeRestrictions(CallingMethod[key], dnsConfig.minFeeRestrictions[key]);
        await tx.wait();
      }
      // set conditional managers
      tx = await PrimexDNS.setConditionalManager("1", LimitPriceCOM.address);
      await tx.wait();

      tx = await PrimexDNS.setConditionalManager("2", TakeProfitStopLossCCM.address);
      await tx.wait();
    } else {
      // max protocol fee
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setMaxProtocolFee",
            [dnsConfig.maxProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(dnsConfig.maxProtocolFee)],
            "PrimexDNS",
            PrimexDNS.address,
          )
        ).payload,
      );

      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setLeverageTolerance", [parseEther(dnsConfig.leverageTolerance)], "PrimexDNS", PrimexDNS.address))
          .payload,
      );

      // protocol fee coefficient
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setProtocolFeeCoefficient",
            [parseEther(dnsConfig.protocolFeeCoefficient)],
            "PrimexDNS",
            PrimexDNS.address,
          )
        ).payload,
      );

      // liquidation gas amount
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setLiquidationGasAmount", [dnsConfig.liquidationGasAmount], "PrimexDNS", PrimexDNS.address)).payload,
      );

      // pmx discount account
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "setPmxDiscountMultiplier",
            [parseEther(dnsConfig.pmxDiscountMultiplier)],
            "PrimexDNS",
            PrimexDNS.address,
          )
        ).payload,
      );

      // gas price buffer
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setGasPriceBuffer", [parseEther(dnsConfig.gasPriceBuffer)], "PrimexDNS", PrimexDNS.address)).payload,
      );

      // additional gas spent
      argsForBigTimeLock.targets.push(PrimexDNS.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setAdditionalGasSpent", [dnsConfig.additionalGasSpent], "PrimexDNS", PrimexDNS.address)).payload,
      );

      // fee rates
      for (const key in dnsConfig.feeRates) {
        argsForBigTimeLock.targets.push(PrimexDNS.address);
        const params = {
          feeRateType: FeeRateType[key],
          feeRate: parseEther(dnsConfig.feeRates[key]),
        };
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setProtocolFeeRate", [params], "PrimexDNS", PrimexDNS.address)).payload,
        );
      }

      // average gas per action
      for (const key in dnsConfig.averageGasPerAction) {
        argsForBigTimeLock.targets.push(PrimexDNS.address);
        const params = {
          tradingOrderType: TradingOrderType[key],
          averageGasPerAction: dnsConfig.averageGasPerAction[key],
        };
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setAverageGasPerAction", [params], "PrimexDNS", PrimexDNS.address)).payload,
        );
      }

      // min fee restrictions
      for (const key in dnsConfig.minFeeRestrictions) {
        argsForBigTimeLock.targets.push(PrimexDNS.address);
        argsForBigTimeLock.payloads.push(
          (
            await encodeFunctionData(
              "setMinFeeRestrictions",
              [CallingMethod[key], dnsConfig.minFeeRestrictions[key]],
              "PrimexDNS",
              PrimexDNS.address,
            )
          ).payload,
        );
      }

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
     * FlashLoanManager deploy
     */

    const flashLoanManagerConfig = generalConfig.FlashLoanManagerConfig;
    const FlashLoanManager = await run("deploy:FlashLoanManager", {
      registry: Registry.address,
      primexDNS: PrimexDNS.address,
      whiteBlackList: WhiteBlackList.address,
      flashLoanFeeRate: parseEther(flashLoanManagerConfig.flashLoanFeeRate).toString(),
      flashLoanProtocolRate: parseEther(flashLoanManagerConfig.flashLoanProtocolRate).toString(),
      tokenTransfersLibrary: TokenTransfersLibrary.address,
      notExecuteNewDeployedTasks: true,
    });
    addToWhiteList.push(FlashLoanManager.address);
    const FLASH_LOAN_MANAGER_ROLE = keccak256(toUtf8Bytes("FLASH_LOAN_MANAGER_ROLE"));
    if (executeFromDeployer) {
      tx = await Registry.grantRole(FLASH_LOAN_MANAGER_ROLE, FlashLoanManager.address);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("grantRole", [FLASH_LOAN_MANAGER_ROLE, FlashLoanManager.address], "PrimexRegistry", Registry.address))
          .payload,
      );
    }

    /**
     * Bucket upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: BucketsFactory.address,
      contractName: "Bucket",
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
        TokenApproveLibrary: TokenApproveLibrary.address,
      },
      isBeacon: true,
    });

    const BucketImplementation = await getContract("Bucket");

    const BucketsFactoryV2Address = await deploy("BucketsFactoryV2", {
      from: deployer,
      args: [Registry.address, PTokensFactory.address, DebtTokensFactory.address, BucketImplementation.address],
      log: true,
    });

    addToWhiteList.push(BucketsFactoryV2Address.address);

    const BucketsFactoryV2 = await getContractAt("BucketsFactoryV2", BucketsFactoryV2Address.address);
    tx = await BucketsFactoryV2.transferOwnership(PrimexProxyAdmin.address);
    await tx.wait();

    if (executeFromDeployer) {
      tx = await PTokensFactory.setBucketsFactory(BucketsFactoryV2Address.address);
      await tx.wait();

      tx = await DebtTokensFactory.setBucketsFactory(BucketsFactoryV2Address.address);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(PTokensFactory.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setBucketsFactory", [BucketsFactoryV2Address.address], "PTokensFactory", PTokensFactory.address))
          .payload,
      );

      argsForBigTimeLock.targets.push(DebtTokensFactory.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setBucketsFactory", [BucketsFactoryV2Address.address], "DebtTokensFactory", DebtTokensFactory.address))
          .payload,
      );
    }

    // set bucket extention
    const buckets = await BucketsFactory.allBuckets();
    if (executeFromDeployer) {
      for (let i = 0; i < buckets.length; i++) {
        const bucket = await getContractAt("Bucket", buckets[i]);
        tx = await bucket.setBucketExtension(BucketExtension.address);
        await tx.wait();
      }
    } else {
      // min fee restrictions
      for (let i = 0; i < buckets.length; i++) {
        argsForBigTimeLock.targets.push(buckets[i]);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("setBucketExtension", [BucketExtension.address], "Bucket", buckets[i])).payload,
        );
      }
    }

    /**
     * P-Token upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: PTokensFactory.address,
      contractName: "PToken",
      libraries: {},
      isBeacon: true,
    });

    /**
     * Debt-Token upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: DebtTokensFactory.address,
      contractName: "DebtToken",
      libraries: {},
      isBeacon: true,
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

    /**
     * SpotTradingRewardDistributor upgrade
     */
    await upgradeProxyWithCheck({
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
    await upgradeProxyWithCheck({
      proxyAddress: ActivityRewardDistributor.address,
      contractName: "ActivityRewardDistributor",
      libraries: {},
      isBeacon: false,
    });

    /**
     * LiquidityMiningRewardDistributor upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: LiquidityMiningRewardDistributor.address,
      contractName: "LiquidityMiningRewardDistributor",
      libraries: {},
      isBeacon: false,
    });

    /**
     * Reserve upgrade
     */
    await upgradeProxyWithCheck({
      proxyAddress: Reserve.address,
      contractName: "Reserve",
      libraries: {},
      isBeacon: false,
    });

    /**
     * SwapManager deploy
     */
    const OldSwapManager = await getContract("SwapManager");

    const SwapManager = await run("deploy:SwapManager", {
      primexDNS: PrimexDNS.address,
      registry: Registry.address,
      traderBalanceVault: TraderBalanceVault.address,
      priceOracle: PriceOracle.address,
      whiteBlackList: WhiteBlackList.address,
      primexPricingLibrary: PrimexPricingLibrary.address,
      tokenTransfersLibrary: TokenTransfersLibrary.address,
      notExecuteNewDeployedTasks: true,
    });

    // set new swap manager
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));

    addToWhiteList.push(SwapManager.address);
    removeFromWhiteList.push(OldSwapManager.address);

    if (executeFromDeployer) {
      const SwapManagerContract = await getContractAt("SwapManager", SwapManager.address);
      tx = await SwapManagerContract.initializeAfterUpgrade(
        PrimexDNS.address,
        TraderBalanceVault.address,
        PriceOracle.address,
        WhiteBlackList.address,
      );
      await tx.wait();

      tx = await LimitOrderManager.setSwapManager(SwapManager.address);
      await tx.wait();

      tx = await Registry.grantRole(VAULT_ACCESS_ROLE, SwapManager.address);
      await tx.wait();

      tx = await Registry.revokeRole(VAULT_ACCESS_ROLE, OldSwapManager.address);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(SwapManager.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "initializeAfterUpgrade",
            [PrimexDNS.address, TraderBalanceVault.address, PriceOracle.address, WhiteBlackList.address],
            "SwapManager",
            SwapManager.address,
          )
        ).payload,
      );

      argsForBigTimeLock.targets.push(LimitOrderManager.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setSwapManager", [SwapManager.address], "LimitOrderManager", LimitOrderManager.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, SwapManager.address], "PrimexRegistry", Registry.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("revokeRole", [VAULT_ACCESS_ROLE, OldSwapManager.address], "PrimexRegistry", Registry.address)).payload,
      );
    }

    /**
     * BatchManager deploy
     */

    const batchManagerConfig = generalConfig.BatchManagerConfig;

    const OldBatchManager = await getContract("BatchManager");

    const BatchManager = await run("deploy:BatchManager", {
      registry: Registry.address,
      primexPricingLibrary: PrimexPricingLibrary.address,
      positionLibrary: PositionLibrary.address,
      positionManager: PositionManager.address,
      priceOracle: PriceOracle.address,
      whiteBlackList: WhiteBlackList.address,
      gasPerPosition: batchManagerConfig.gasPerPosition,
      gasPerBatch: batchManagerConfig.gasPerBatch,
      tokenTransfersLibrary: TokenTransfersLibrary.address,
      notExecuteNewDeployedTasks: true,
    });

    addToWhiteList.push(BatchManager.address);
    removeFromWhiteList.push(OldBatchManager.address);

    const BATCH_MANAGER_ROLE = keccak256(toUtf8Bytes("BATCH_MANAGER_ROLE"));
    // manage roles
    if (executeFromDeployer) {
      const BatchManagerContract = await getContractAt("BatchManager", BatchManager.address);
      tx = await BatchManagerContract.initializeAfterUpgrade(
        PositionManager.address,
        PriceOracle.address,
        WhiteBlackList.address,
        batchManagerConfig.gasPerPosition,
        batchManagerConfig.gasPerBatch,
      );
      await tx.wait();

      tx = await Registry.grantRole(BATCH_MANAGER_ROLE, BatchManager.address);
      await tx.wait();

      tx = await Registry.grantRole(VAULT_ACCESS_ROLE, BatchManager.address);
      await tx.wait();

      tx = await Registry.revokeRole(BATCH_MANAGER_ROLE, OldBatchManager.address);
      await tx.wait();

      tx = await Registry.revokeRole(VAULT_ACCESS_ROLE, OldBatchManager.address);
      await tx.wait();

      tx = await Registry.setRoleAdmin(VAULT_ACCESS_ROLE, SMALL_TIMELOCK_ADMIN);
      await tx.wait();

      tx = await Registry.setRoleAdmin(NO_FEE_ROLE, SMALL_TIMELOCK_ADMIN);
      await tx.wait();
    } else {
      argsForBigTimeLock.targets.push(BatchManager.address);
      argsForBigTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "initializeAfterUpgrade",
            [
              PositionManager.address,
              PriceOracle.address,
              WhiteBlackList.address,
              batchManagerConfig.gasPerPosition,
              batchManagerConfig.gasPerBatch,
            ],
            "BatchManager",
            BatchManager.address,
          )
        ).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("grantRole", [BATCH_MANAGER_ROLE, BatchManager.address], "PrimexRegistry", Registry.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, BatchManager.address], "PrimexRegistry", Registry.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("revokeRole", [BATCH_MANAGER_ROLE, OldBatchManager.address], "PrimexRegistry", Registry.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("revokeRole", [VAULT_ACCESS_ROLE, OldBatchManager.address], "PrimexRegistry", Registry.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setRoleAdmin", [VAULT_ACCESS_ROLE, SMALL_TIMELOCK_ADMIN], "PrimexRegistry", Registry.address)).payload,
      );

      argsForBigTimeLock.targets.push(Registry.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setRoleAdmin", [NO_FEE_ROLE, SMALL_TIMELOCK_ADMIN], "PrimexRegistry", Registry.address)).payload,
      );
    }

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

    // add new dexes
    const existingDexes = await PrimexDNS.getAllDexes();

    const routers = [];
    const names = [];
    const dexTypes = [];
    const quoters = {};

    const newRouters = [];
    const newNames = [];

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

      // Add data only for new DEXes
      if (!existingDexes.includes(dexName)) {
        newNames.push(dexName);
        newRouters.push(dexRouter);
      }
    }

    if (names.length !== routers.length || newNames.length !== newRouters.length)
      throw new Error("length of router addresses and the length of the names do not match");
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

      // Add only new DEXes to PrimexDNS
      for (let i = 0; i < newNames.length; i++) {
        tx = await PrimexDNS.addDEX(newNames[i], newRouters[i]);
        await tx.wait();
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

      // Add only new DEXes to PrimexDNS
      for (let i = 0; i < newNames.length; i++) {
        argsForBigTimeLock.targets.push(PrimexDNS.address);
        argsForBigTimeLock.payloads.push(
          (await encodeFunctionData("addDEX", [newNames[i], newRouters[i]], "PrimexDNS", DexAdapter.address)).payload,
        );
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

    const primexUpkeep = await deploy("PrimexUpkeep", {
      from: deployer,
      args: [Registry.address],
      log: true,
    });

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
