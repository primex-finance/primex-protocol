// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits, keccak256, toUtf8Bytes },
    constants: { MaxUint256 },
    BigNumber,
    provider,
  },
  deployments: { fixture, getArtifact },
} = require("hardhat");

const {
  CloseReason,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  USD_DECIMALS,
  USD_MULTIPLIER,
  PaymentModel,
} = require("../utils/constants");
const { getLimitPriceAdditionalParams, getLimitPriceParams } = require("../utils/conditionParams");
const { wadMul, wadDiv, MAX_TOKEN_DECIMALITY } = require("../utils/bnMath");
const {
  getAmountsOut,
  addLiquidity,
  checkIsDexSupported,
  getSingleMegaRoute,
  swapExactTokensForTokens,
} = require("../utils/dexOperations");
const { getTakeProfitStopLossParams, getCondition } = require("../utils/conditionParams");
const { NATIVE_CURRENCY, WAD, ArbGasInfo, OVM_GASPRICEORACLE, KeeperActionType } = require("../utils/constants");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
  reversePrice,
} = require("../utils/oracleUtils");

process.env.TEST = true;

describe("KeeperRewardDistributor_integration", function () {
  let dex,
    positionManager,
    testTokenA,
    testTokenB,
    bucket,
    PrimexDNS,
    bucketAddress,
    primexPricingLibrary,
    firstAssetRoutes,
    routesForClose,
    treasury,
    dexAdapter;
  let priceOracle, registry;
  let deployer, trader, lender, liquidator;
  let snapshotId;
  let decimalsA, decimalsB;
  let multiplierA, multiplierB;
  let OpenPositionParams;
  let positionAmount, price, priceBA, depositAmount, borrowedAmount, swapSize;
  let PMXToken;
  let KeeperRewardDistributor, primexPricingLibraryMock;
  let limitOrderManager;
  let additionalGas, positionSizeCoefficient, nativePartInReward, pmxPartInReward, oracleGasPriceTolerance;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender, liquidator } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    // dec = await
    PrimexDNS = await getContract("PrimexDNS");
    await PrimexDNS.setLeverageTolerance(parseEther("0.2"));
    PMXToken = await getContract("EPMXToken");
    KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    treasury = await getContract("Treasury");
    limitOrderManager = await getContract("LimitOrderManager");
    dexAdapter = await getContract("DexAdapter");

    const registryAddress = await dexAdapter.registry();
    registry = await getContractAt("PrimexRegistry", registryAddress);
    const PM_ROLE = keccak256(toUtf8Bytes("PM_ROLE"));
    const txGrantRole = await registry.grantRole(PM_ROLE, liquidator.address);
    await txGrantRole.wait();

    dex = process.env.DEX ? process.env.DEX : "uniswap";
    checkIsDexSupported(dex);

    firstAssetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);
    routesForClose = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("10", USD_DECIMALS));
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    depositAmount = parseUnits("15", decimalsA);
    borrowedAmount = parseUnits("25", decimalsA);
    swapSize = depositAmount.add(borrowedAmount);

    const lenderAmount = parseUnits("50", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
    await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
    const deadline = new Date().getTime() + 600;

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      closeConditions: [],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const price0 = wadDiv(swap, amountB);
    price = price0.div(multiplierA);

    const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
    priceBA = BigNumber.from(limitPrice).div(USD_MULTIPLIER);

    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();

    additionalGas = await KeeperRewardDistributor.additionalGas();
    positionSizeCoefficient = await KeeperRewardDistributor.positionSizeCoefficient();
    nativePartInReward = await KeeperRewardDistributor.nativePartInReward();
    pmxPartInReward = await KeeperRewardDistributor.pmxPartInReward();
    oracleGasPriceTolerance = await KeeperRewardDistributor.oracleGasPriceTolerance();
  });

  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: new Date().getTime() + 600,
      takeDepositFromWallet: true,
      closeConditions: [],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    };
  });

  it("Should updateReward for keeper", async function () {
    const updateRewardParams = {
      keeper: liquidator.address,
      positionAsset: testTokenB.address,
      positionSize: parseUnits("500", decimalsB),
      action: KeeperActionType.Liquidation,
      numberOfActions: 1,
      gasSpent: BigNumber.from("10000"),
      decreasingCounter: [],
      routesLength: 0,
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
    };
    const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
      testTokenB.address,
      NATIVE_CURRENCY,
      updateRewardParams.positionSize,
      priceOracle.address,
      getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
    );
    const tx = await KeeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);

    const receipt = await tx.wait();
    const gasCost = updateRewardParams.gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice);
    const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
    const reward = gasCost.add(positionSizeAddend);
    const rewardInEth = wadMul(reward, nativePartInReward);
    const rewardInPmx = wadMul(
      await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        PMXToken.address,
        reward,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      ),
      pmxPartInReward,
    );

    const { pmxBalance, nativeBalance } = await KeeperRewardDistributor.keeperBalance(liquidator.address);
    expect(rewardInEth).to.be.equal(nativeBalance);
    expect(rewardInPmx).to.be.equal(pmxBalance);

    const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRewardDistributor.totalBalance();
    expect(totalPmxBalance).to.be.equal(pmxBalance);
    expect(totalNativeBalance).to.be.equal(nativeBalance);
  });

  describe("updateReward_ArbitrumPaymentModel", function () {
    let l1GasPrice, initParams, KeeperRDFactory, positionAmount, gasSpent;
    before(async function () {
      l1GasPrice = 30e9;
      const pmx = await getContract("EPMXToken");
      const whiteBlackList = await getContract("WhiteBlackList");
      const defaultMaxGasPrice = await KeeperRewardDistributor.defaultMaxGasPrice();
      const arbGasInfoArtifact = await getArtifact("ArbGasInfoMock");
      await network.provider.send("hardhat_setCode", [ArbGasInfo, arbGasInfoArtifact.deployedBytecode]);
      const arbGasInfo = await getContractAt("ArbGasInfoMock", ArbGasInfo);
      await arbGasInfo.setL1BaseFeeEstimate(l1GasPrice);

      KeeperRDFactory = await getContractFactory("KeeperRewardDistributor", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      initParams = {
        pmx: pmx.address,
        pmxPartInReward: pmxPartInReward,
        nativePartInReward: nativePartInReward,
        positionSizeCoefficient: positionSizeCoefficient,
        additionalGas: additionalGas,
        oracleGasPriceTolerance: parseUnits("1", 17),
        paymentModel: PaymentModel.ARBITRUM,
        defaultMaxGasPrice: defaultMaxGasPrice,
        registry: registry.address,
        priceOracle: priceOracle.address,
        treasury: treasury.address,
        whiteBlackList: whiteBlackList.address,
        maxGasPerPositionParams: [
          {
            actionType: KeeperActionType.Liquidation,
            config: {
              baseMaxGas1: "100000000",
              baseMaxGas2: "100000000",
              multiplier1: parseEther("100"),
              multiplier2: "0",
              inflectionPoint: "0",
            },
          },
        ],
        decreasingGasByReasonParams: [],
      };
      positionAmount = parseUnits("5", decimalsB);
      gasSpent = BigNumber.from("100000");

      await upgrades.silenceWarnings();
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should correctly updateReward for keeper by arbitrum payment model when callingMethod is OpenPositionByOrder", async function () {
      const baseLength = 196;
      const routesLength = 200;
      const maxRoutesLength = 3200;
      initParams.maxGasPerPositionParams = [
        {
          actionType: KeeperActionType.OpenByOrder,
          config: {
            baseMaxGas1: "100000",
            baseMaxGas2: "100000",
            multiplier1: parseEther("100"),
            multiplier2: "0",
            inflectionPoint: "0",
          },
        },
      ];
      const KeeperRDArbitrum = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDArbitrum.setDataLengthRestrictions(1, maxRoutesLength, baseLength);
      const tx = await KeeperRDArbitrum.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.OpenByOrder,
        numberOfActions: 1,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();
      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1CostWei = l1GasPrice * 16 * (routesLength + baseLength + 140);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDArbitrum.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDArbitrum.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });

    it("Should correctly updateReward for keeper by arbitrum payment model when callingMethod is ClosePositionByCondition", async function () {
      const baseLength = 196;
      const routesLength = 200;
      const maxRoutesLength = 1600;
      initParams.maxGasPerPositionParams[0].actionType = KeeperActionType.Liquidation;
      const KeeperRDArbitrum = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDArbitrum.setDataLengthRestrictions(0, maxRoutesLength, baseLength);
      const tx = await KeeperRDArbitrum.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.Liquidation,
        numberOfActions: 1,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();

      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1CostWei = l1GasPrice * 16 * (routesLength + baseLength + 140);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDArbitrum.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDArbitrum.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });

    it("Should correctly updateReward for keeper by arbitrum payment model when callingMethod is CloseBatchPositions", async function () {
      const baseLength = 260;
      const routesLength = 1200;
      const maxRoutesLength = 1600;
      const batchValidPositionsLength = 192; // 3 numberOfActions * 64 bytes
      const variableLength = routesLength + batchValidPositionsLength;
      initParams.maxGasPerPositionParams[0].actionType = KeeperActionType.Liquidation;
      const KeeperRDArbitrum = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDArbitrum.setDataLengthRestrictions(2, maxRoutesLength, baseLength);
      const tx = await KeeperRDArbitrum.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.Liquidation,
        numberOfActions: 3,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();

      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1CostWei = l1GasPrice * 16 * (variableLength + baseLength + 140);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDArbitrum.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDArbitrum.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });

    it("Should used maxRoutesLength instead of routesLength when routesLength > maxRoutesLength", async function () {
      const baseLength = 260;
      const routesLength = 1700;
      const maxRoutesLength = 1600;
      const batchValidPositionsLength = 192; // 3 numberOfActions * 64 bytes
      const KeeperRDArbitrum = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDArbitrum.setDataLengthRestrictions(2, maxRoutesLength, baseLength);
      const tx = await KeeperRDArbitrum.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.Liquidation,
        numberOfActions: 3,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();

      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1CostWei = l1GasPrice * 16 * (maxRoutesLength + baseLength + batchValidPositionsLength + 140);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDArbitrum.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDArbitrum.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });
  });
  describe("updateReward_OptimisticPaymentModel", function () {
    let initParams, KeeperRDFactory, positionAmount, gasSpent, ovmGasPriceOracle;
    before(async function () {
      const pmx = await getContract("EPMXToken");
      const whiteBlackList = await getContract("WhiteBlackList");
      const defaultMaxGasPrice = await KeeperRewardDistributor.defaultMaxGasPrice();
      const ovmGasPriceOracleArtifact = await getArtifact("OVM_GasPriceOracleMock");
      await network.provider.send("hardhat_setCode", [OVM_GASPRICEORACLE, ovmGasPriceOracleArtifact.deployedBytecode]);
      ovmGasPriceOracle = await getContractAt("OVM_GasPriceOracleMock", OVM_GASPRICEORACLE);

      KeeperRDFactory = await getContractFactory("KeeperRewardDistributor", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      initParams = {
        pmx: pmx.address,
        pmxPartInReward: pmxPartInReward,
        nativePartInReward: nativePartInReward,
        positionSizeCoefficient: positionSizeCoefficient,
        additionalGas: additionalGas,
        oracleGasPriceTolerance: parseUnits("1", 17),
        paymentModel: PaymentModel.OPTIMISTIC,
        defaultMaxGasPrice: defaultMaxGasPrice,
        registry: registry.address,
        priceOracle: priceOracle.address,
        treasury: treasury.address,
        whiteBlackList: whiteBlackList.address,
        maxGasPerPositionParams: [
          {
            actionType: KeeperActionType.Liquidation,
            config: {
              baseMaxGas1: "100000000",
              baseMaxGas2: "100000000",
              multiplier1: parseEther("100"),
              multiplier2: "0",
              inflectionPoint: "0",
            },
          },
        ],
        decreasingGasByReasonParams: [],
      };
      positionAmount = parseUnits("5", decimalsB);
      gasSpent = BigNumber.from("100000");

      await upgrades.silenceWarnings();
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should correctly updateReward for keeper by optimistic payment model when callingMethod is OpenPositionByOrder", async function () {
      const baseLength = 196;
      const routesLength = 200;
      const maxRoutesLength = 3200;

      initParams.maxGasPerPositionParams = [
        {
          actionType: KeeperActionType.OpenByOrder,
          config: {
            baseMaxGas1: "100000",
            baseMaxGas2: "100000",
            multiplier1: parseEther("100"),
            multiplier2: "0",
            inflectionPoint: "0",
          },
        },
      ];
      const KeeperRDOptimistic = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDOptimistic.setDataLengthRestrictions(1, maxRoutesLength, baseLength);
      await KeeperRDOptimistic.setOptimisticGasCoefficient(WAD);
      const tx = await KeeperRDOptimistic.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.OpenByOrder,
        numberOfActions: 1,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();
      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1FeeUpperBound = await ovmGasPriceOracle.getL1FeeUpperBound(routesLength + baseLength);
      const l1CostWei = wadMul(l1FeeUpperBound, WAD);
      const gasAmount = gasSpent.add(additionalGas);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasAmount.mul(receipt.effectiveGasPrice).add(l1CostWei.toString()).add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);

      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDOptimistic.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDOptimistic.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });
    it("Should correctly updateReward for keeper by optimistic payment model when the OptimisticGasCoefficient is greater than WAD", async function () {
      const baseLength = 196;
      const routesLength = 200;
      const maxRoutesLength = 3200;

      initParams.maxGasPerPositionParams = [
        {
          actionType: KeeperActionType.OpenByOrder,
          config: {
            baseMaxGas1: "100000",
            baseMaxGas2: "100000",
            multiplier1: parseEther("100"),
            multiplier2: "0",
            inflectionPoint: "0",
          },
        },
      ];
      const KeeperRDOptimistic = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDOptimistic.setDataLengthRestrictions(1, maxRoutesLength, baseLength);
      const optimisticGasCoefficient = BigNumber.from("12").mul(BigNumber.from("10").pow("17")); // 1.2 WAD
      await KeeperRDOptimistic.setOptimisticGasCoefficient(optimisticGasCoefficient);
      const tx = await KeeperRDOptimistic.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.OpenByOrder,
        numberOfActions: 1,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();
      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1FeeUpperBound = await ovmGasPriceOracle.getL1FeeUpperBound(routesLength + baseLength);
      const l1CostWei = wadMul(l1FeeUpperBound, optimisticGasCoefficient);
      const gasAmount = gasSpent.add(additionalGas);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasAmount.mul(receipt.effectiveGasPrice).add(l1CostWei.toString()).add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);

      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDOptimistic.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDOptimistic.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });

    it("Should correctly updateReward for keeper by optimistic payment model when callingMethod is ClosePositionByCondition", async function () {
      const baseLength = 196;
      const routesLength = 200;
      const maxRoutesLength = 1600;
      initParams.maxGasPerPositionParams[0].actionType = KeeperActionType.Liquidation;
      const KeeperRDOptimistic = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDOptimistic.setDataLengthRestrictions(0, maxRoutesLength, baseLength);
      await KeeperRDOptimistic.setOptimisticGasCoefficient(WAD);

      const tx = await KeeperRDOptimistic.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.Liquidation,
        numberOfActions: 1,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();

      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1FeeUpperBound = await ovmGasPriceOracle.getL1FeeUpperBound(routesLength + baseLength);
      const l1CostWei = wadMul(l1FeeUpperBound, WAD);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDOptimistic.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDOptimistic.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });

    it("Should correctly updateReward for keeper by optimistic payment model when callingMethod is CloseBatchPositions", async function () {
      const baseLength = 260;
      const routesLength = 1200;
      const maxRoutesLength = 1600;
      const batchValidPositionsLength = 192; // 3 numberOfActions * 64 bytes
      const variableLength = routesLength + batchValidPositionsLength;
      initParams.maxGasPerPositionParams[0].actionType = KeeperActionType.Liquidation;
      const KeeperRDOptimistic = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDOptimistic.setDataLengthRestrictions(2, maxRoutesLength, baseLength);
      await KeeperRDOptimistic.setOptimisticGasCoefficient(WAD);
      const tx = await KeeperRDOptimistic.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.Liquidation,
        numberOfActions: 3,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();

      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1FeeUpperBound = await ovmGasPriceOracle.getL1FeeUpperBound(variableLength + baseLength);
      const l1CostWei = wadMul(l1FeeUpperBound, WAD);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);

      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDOptimistic.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDOptimistic.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });

    it("Should used maxRoutesLength instead of routesLength when routesLength > maxRoutesLength", async function () {
      const baseLength = 260;
      const routesLength = 1700;
      const maxRoutesLength = 1600;
      const batchValidPositionsLength = 192; // 3 numberOfActions * 64 bytes
      const KeeperRDOptimistic = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      await KeeperRDOptimistic.setDataLengthRestrictions(2, maxRoutesLength, baseLength);
      await KeeperRDOptimistic.setOptimisticGasCoefficient(WAD);
      const tx = await KeeperRDOptimistic.connect(liquidator).updateReward({
        keeper: liquidator.address,
        positionAsset: testTokenB.address,
        positionSize: positionAmount,
        action: KeeperActionType.Liquidation,
        numberOfActions: 3,
        gasSpent: gasSpent,
        decreasingCounter: [],
        routesLength: routesLength,
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      });
      const receipt = await tx.wait();

      const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenB.address,
        NATIVE_CURRENCY,
        positionAmount,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      );
      const l1FeeUpperBound = await ovmGasPriceOracle.getL1FeeUpperBound(maxRoutesLength + baseLength + batchValidPositionsLength);
      const l1CostWei = wadMul(l1FeeUpperBound, WAD);
      const gasCost = gasSpent.add(additionalGas).mul(receipt.effectiveGasPrice).add(l1CostWei);
      const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
      const reward = gasCost.add(positionSizeAddend);
      const rewardInEth = wadMul(reward, nativePartInReward);
      const rewardInPmx = wadMul(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          NATIVE_CURRENCY,
          PMXToken.address,
          reward,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        ),
        pmxPartInReward,
      );

      const { pmxBalance, nativeBalance } = await KeeperRDOptimistic.keeperBalance(liquidator.address);
      expect(rewardInEth).to.be.equal(nativeBalance);
      expect(rewardInPmx).to.be.equal(pmxBalance);

      const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRDOptimistic.totalBalance();
      expect(totalPmxBalance).to.be.equal(pmxBalance);
      expect(totalNativeBalance).to.be.equal(nativeBalance);
    });
  });

  it("Should updateReward by maxGasAmount when gasSpent > maxGasAmount", async function () {
    const updateRewardParams = {
      keeper: liquidator.address,
      positionAsset: testTokenB.address,
      positionSize: parseUnits("500", decimalsB),
      action: KeeperActionType.Liquidation,
      numberOfActions: 1,
      gasSpent: BigNumber.from("10000"),
      decreasingCounter: [],
      routesLength: 0,
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
    };
    const { multiplier1, baseMaxGas1 } = await KeeperRewardDistributor.maxGasPerPosition(updateRewardParams.action);
    const maxGasAmount = multiplier1.mul(updateRewardParams.numberOfActions).add(baseMaxGas1);
    updateRewardParams.gasSpent = maxGasAmount.add(10);
    const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
      testTokenB.address,
      NATIVE_CURRENCY,
      updateRewardParams.positionSize,
      priceOracle.address,
      getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
    );

    const tx = await KeeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);

    const receipt = await tx.wait();
    const gasCost = maxGasAmount.mul(receipt.effectiveGasPrice);
    const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
    const reward = gasCost.add(positionSizeAddend);
    const rewardInEth = wadMul(reward, nativePartInReward);
    const rewardInPmx = wadMul(
      await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        PMXToken.address,
        reward,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      ),
      pmxPartInReward,
    );

    const { pmxBalance, nativeBalance } = await KeeperRewardDistributor.keeperBalance(liquidator.address);
    expect(rewardInEth).to.be.equal(nativeBalance);
    expect(rewardInPmx).to.be.equal(pmxBalance);

    const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRewardDistributor.totalBalance();
    expect(totalPmxBalance).to.be.equal(pmxBalance);
    expect(totalNativeBalance).to.be.equal(nativeBalance);
  });

  it("Should updateReward by oracleGasPrice when gasPrice > oracleGasPrice + %", async function () {
    // We skip this test because coverage plugin sets gasPrice = 1 and test fails
    if (process.env.COVERAGE) this.skip();
    const updateRewardParams = {
      keeper: liquidator.address,
      positionAsset: testTokenB.address,
      positionSize: parseUnits("500", decimalsB),
      action: KeeperActionType.Liquidation,
      numberOfActions: 1,
      gasSpent: BigNumber.from("10000"),
      decreasingCounter: [],
      routesLength: 0,
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
    };

    const mockPriceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceOracle.setGasPriceFeed(mockPriceFeed.address);
    await mockPriceFeed.setAnswer("1000000");

    const ethAmount = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
      updateRewardParams.positionAsset,
      NATIVE_CURRENCY,
      updateRewardParams.positionSize,
      priceOracle.address,
      getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
    );

    await KeeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);

    const oracleGasPrice = (await priceOracle.getGasPrice()).toString();
    const maxGasPricePlusTolerance = wadMul(oracleGasPrice, BigNumber.from(WAD).add(oracleGasPriceTolerance).toString());
    const gasCost = updateRewardParams.gasSpent.add(additionalGas).mul(maxGasPricePlusTolerance);
    const positionSizeAddend = wadMul(ethAmount, positionSizeCoefficient);
    const reward = gasCost.add(positionSizeAddend);
    const rewardInEth = wadMul(reward, nativePartInReward);
    const rewardInPmx = wadMul(
      await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        PMXToken.address,
        reward,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      ),
      pmxPartInReward,
    );

    const { pmxBalance, nativeBalance } = await KeeperRewardDistributor.keeperBalance(liquidator.address);
    expect(rewardInEth).to.be.equal(nativeBalance);
    expect(rewardInPmx).to.be.equal(pmxBalance);

    const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRewardDistributor.totalBalance();
    expect(totalPmxBalance).to.be.equal(pmxBalance);
    expect(totalNativeBalance).to.be.equal(nativeBalance);
  });

  it("Should close position by stop loss condition and update keeper balance", async function () {
    const conditionIndex = 0;
    const stopLossPrice = BigNumber.from(price).mul(multiplierA).sub("1").toString();
    const takeProfitPrice = BigNumber.from(price).mul(multiplierA).add("1").toString();

    OpenPositionParams.closeConditions = [
      getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
    ];
    await setOraclePrice(testTokenA, testTokenB, priceBA);

    await positionManager.connect(trader).openPosition(OpenPositionParams);

    const SLPrice = BigNumber.from(priceBA).add(2);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    await setOraclePrice(testTokenA, testTokenB, SLPrice);
    await network.provider.send("evm_increaseTime", [10]);

    await positionManager.connect(liquidator).closePositionByCondition({
      id: 0,
      keeper: liquidator.address,
      megaRoutes: routesForClose,
      conditionIndex: conditionIndex,
      ccmAdditionalParams: "0x",
      closeReason: CloseReason.LIMIT_CONDITION,
      positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.gt(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.gt(0);
  });

  it("Should close risky position and update keeper balance", async function () {
    await positionManager.connect(trader).openPosition(OpenPositionParams);
    const closeRoute = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);
    const badPrice = BigNumber.from(priceBA).mul(2);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    await network.provider.send("evm_increaseTime", [10]);
    // set a bad price
    await setOraclePrice(testTokenA, testTokenB, badPrice);

    await positionManager.connect(liquidator).closePositionByCondition({
      id: 0,
      keeper: liquidator.address,
      megaRoutes: closeRoute,
      conditionIndex: 0,
      ccmAdditionalParams: "0x",
      closeReason: CloseReason.RISKY_POSITION,
      positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.gt(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.gt(0);
  });

  it("Should batch close risky positions and update keeper balance", async function () {
    const batchManager = await getContract("BatchManager");
    OpenPositionParams.marginParams.borrowedAmount = parseUnits("1", decimalsA);
    OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
    await positionManager.connect(trader).openPosition(OpenPositionParams);
    await positionManager.connect(trader).openPosition(OpenPositionParams);
    const closeRoute = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

    const badPrice = BigNumber.from(priceBA).mul(10);

    // set a bad price
    await setOraclePrice(testTokenA, testTokenB, badPrice);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    await batchManager
      .connect(liquidator)
      .closeBatchPositions(
        [0, 1],
        closeRoute,
        testTokenB.address,
        testTokenA.address,
        bucketAddress,
        [0, 0],
        CloseReason.BATCH_LIQUIDATION,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd(PMXToken),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      );

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.gt(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.gt(0);
  });
  it("Should close batch positions by SL and update keeper balance", async function () {
    const batchManager = await getContract("BatchManager");

    const stopLossPrice = reversePrice(priceBA.toString()).mul(USD_MULTIPLIER).sub("1").toString();
    const takeProfitPrice = reversePrice(priceBA.toString()).mul(USD_MULTIPLIER).add("1").toString();

    OpenPositionParams.closeConditions = [
      getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
    ];
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));
    await setOraclePrice(testTokenA, testTokenB, priceBA);
    await positionManager.connect(trader).openPosition(OpenPositionParams);
    await swapExactTokensForTokens({
      dex: dex,
      amountIn: positionAmount,
      path: [testTokenB.address, testTokenA.address],
    });

    await positionManager.connect(trader).openPosition(OpenPositionParams);
    const closeRoute = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

    const SLPrice = priceBA.add("2");
    await setOraclePrice(testTokenA, testTokenB, SLPrice);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    const { payload } = await encodeFunctionData(
      "setOracleTolerableLimit",
      [testTokenA.address, testTokenB.address, BigNumber.from(WAD.toString()).div("2")],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);
    await batchManager
      .connect(liquidator)
      .closeBatchPositions(
        [0, 1],
        closeRoute,
        testTokenB.address,
        testTokenA.address,
        bucketAddress,
        [0, 0],
        CloseReason.BATCH_STOP_LOSS,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd(PMXToken),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      );
    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.gt(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.gt(0);
  });
  it("Should close batch positions by TP and update keeper balance", async function () {
    const batchManager = await getContract("BatchManager");

    const stopLossPrice = BigNumber.from(price).mul(multiplierA).sub("1").toString();

    OpenPositionParams.closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(1, stopLossPrice))];

    await positionManager.connect(trader).openPosition(OpenPositionParams);
    await swapExactTokensForTokens({
      dex: dex,
      amountIn: positionAmount,
      path: [testTokenB.address, testTokenA.address],
    });

    await positionManager.connect(trader).openPosition(OpenPositionParams);
    const closeRoute = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    const { payload } = await encodeFunctionData(
      "setOracleTolerableLimit",
      [testTokenA.address, testTokenB.address, BigNumber.from(WAD.toString())],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);
    await batchManager
      .connect(liquidator)
      .closeBatchPositions(
        [0, 1],
        closeRoute,
        testTokenB.address,
        testTokenA.address,
        bucketAddress,
        [0, 0],
        CloseReason.BATCH_TAKE_PROFIT,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd(PMXToken),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      );

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.gt(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.gt(0);
  });

  it("Should open position by order and update keeper activity", async function () {
    const deadline = new Date().getTime() + 600;
    const takeDepositFromWallet = true;
    await testTokenA.mint(trader.address, depositAmount);
    await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256);
    const slPrice = 0;
    const tpPrice = 0;
    const limitPrice = price.mul(2);
    const positionAsset = testTokenB.address;
    const leverage = parseEther("2");

    await limitOrderManager.connect(trader).createLimitOrder({
      bucket: "bucket1",
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      positionAsset: positionAsset,
      deadline: deadline,
      takeDepositFromWallet: takeDepositFromWallet,
      leverage: leverage,
      shouldOpenPosition: true,
      openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
      closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
      nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });
    const orderId = await limitOrderManager.ordersId();

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );

    const defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);
    await network.provider.send("evm_increaseTime", [10]);
    await limitOrderManager.openPositionByOrder({
      orderId: orderId,
      conditionIndex: 0,
      comAdditionalParams: defaultAdditionalParams,
      firstAssetMegaRoutes: firstAssetRoutes,
      depositInThirdAssetMegaRoutes: [],
      keeper: liquidator.address,
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
      borrowedAmount: wadMul(depositAmount.toString(), leverage.sub(parseEther("1")).toString()).toString(),
    });

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.gt(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.gt(0);
  });

  it("Should not update keeper balance when position closed by trader", async function () {
    await setOraclePrice(testTokenA, testTokenB, priceBA);
    await positionManager.connect(trader).openPosition(OpenPositionParams);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );

    await positionManager
      .connect(trader)
      .closePosition(
        0,
        trader.address,
        routesForClose,
        0,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd(testTokenB),
        getEncodedChainlinkRouteViaUsd(testTokenB),
        [],
        [],
      );

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );

    expect(pmxRewardAfter).to.be.equal(pmxRewardBefore);
    expect(nativeRewardAfter).to.be.equal(nativeRewardBefore);
  });

  it("Should claim reward, update keeper balance and emit events", async function () {
    const conditionIndex = 0;

    const stopLossPrice = BigNumber.from(price).mul(multiplierA).sub("1").toString();
    const takeProfitPrice = BigNumber.from(price).mul(multiplierA).add("1").toString();

    OpenPositionParams.closeConditions = [
      getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
    ];
    await positionManager.connect(trader).openPosition(OpenPositionParams);

    const spendingLimits = {
      maxTotalAmount: MaxUint256,
      maxAmountPerTransfer: MaxUint256,
      maxPercentPerTransfer: parseEther("1").sub(1),
      minTimeBetweenTransfers: 1,
      timeframeDuration: 60 * 60 * 24,
      maxAmountDuringTimeframe: MaxUint256,
    };
    await treasury.connect(deployer).setMaxSpendingLimit(KeeperRewardDistributor.address, PMXToken.address, spendingLimits);
    await treasury.connect(deployer).setMaxSpendingLimit(KeeperRewardDistributor.address, NATIVE_CURRENCY, spendingLimits);
    await PMXToken.transfer(treasury.address, parseEther("100000000"));
    await PMXToken.addAddressesToWhitelist([liquidator.address]);
    await deployer.sendTransaction({
      to: treasury.address,
      value: parseEther("1000"),
    });

    const SLPrice = priceBA.add("2");
    await setOraclePrice(testTokenA, testTokenB, SLPrice);
    await network.provider.send("evm_increaseTime", [10]);
    await positionManager.connect(liquidator).closePositionByCondition({
      id: 0,
      keeper: liquidator.address,
      megaRoutes: routesForClose,
      conditionIndex: conditionIndex,
      ccmAdditionalParams: "0x",
      closeReason: CloseReason.LIMIT_CONDITION,
      positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
      positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
      pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });

    const ethBalanceBefore = await provider.getBalance(liquidator.address);
    const pmxBalanceBefore = await PMXToken.balanceOf(liquidator.address);

    const { pmxBalance: pmxReward, nativeBalance: nativeReward } = await KeeperRewardDistributor.keeperBalance(liquidator.address);
    const tx = await KeeperRewardDistributor.connect(liquidator).claim(pmxReward, nativeReward);

    await expect(tx).to.emit(KeeperRewardDistributor, "ClaimFees").withArgs(liquidator.address, NATIVE_CURRENCY, nativeReward);
    await expect(tx).to.emit(KeeperRewardDistributor, "ClaimFees").withArgs(liquidator.address, PMXToken.address, pmxReward);

    const receipt = await tx.wait();
    const transactionCost = receipt.gasUsed * receipt.effectiveGasPrice;
    const ethBalanceAfter = await provider.getBalance(liquidator.address);
    const pmxBalanceAfter = await PMXToken.balanceOf(liquidator.address);
    expect(ethBalanceAfter.sub(nativeReward)).to.be.equal(ethBalanceBefore.sub(transactionCost));
    expect(pmxBalanceAfter.sub(pmxReward)).to.be.equal(pmxBalanceBefore);

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter).to.be.equal(0);
    expect(nativeRewardAfter).to.be.equal(0);

    const { pmxBalance: totalPmxBalance, nativeBalance: totalNativeBalance } = await KeeperRewardDistributor.totalBalance();
    expect(totalPmxBalance).to.be.equal(0);
    expect(totalNativeBalance).to.be.equal(0);
  });
});
