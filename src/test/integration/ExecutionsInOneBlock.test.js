// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
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
  deployments: { fixture },
} = require("hardhat");

const { CloseReason, LIMIT_PRICE_CM_TYPE, TAKE_PROFIT_STOP_LOSS_CM_TYPE } = require("../utils/constants");
const { getLimitPriceAdditionalParams, getTakeProfitStopLossAdditionalParams, getLimitPriceParams } = require("../utils/conditionParams");
const { wadMul, wadDiv, MAX_TOKEN_DECIMALITY } = require("../utils/bnMath");
const { getAmountsOut, addLiquidity, swapExactTokensForTokens, checkIsDexSupported, getSingleRoute } = require("../utils/dexOperations");
const { getTakeProfitStopLossParams, getCondition } = require("../utils/conditionParams");
const { NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

function tests() {
  let dex,
    positionManager,
    testTokenA,
    testTokenB,
    bucket,
    tokenUSD,
    PrimexDNS,
    bucketAddress,
    primexPricingLibrary,
    firstAssetRoutes,
    routesForClose,
    dexAdapter;
  let priceFeed, priceOracle, priceFeedTTBETH, priceFeedTTAETH, feeAmountInEth;
  let deployer, trader, lender, liquidator;
  let snapshotId;
  let decimalsA, decimalsB, decimalsUSD;
  let multiplierA, multiplierB;
  let OpenPositionParams;
  let positionAmount, price, depositedAmount, borrowedAmount, swapSize;
  let PMXToken;
  let KeeperRewardDistributor, primexPricingLibraryMock;
  let limitOrderManager;

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
    PMXToken = await getContract("EPMXToken");
    KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
    positionManager = await getContract("PositionManager");

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    limitOrderManager = await getContract("LimitOrderManager");
    dexAdapter = await getContract("DexAdapter");

    const registryAddress = await dexAdapter.registry();
    const registry = await getContractAt("PrimexRegistry", registryAddress);
    const PM_ROLE = keccak256(toUtf8Bytes("PM_ROLE"));
    const txGrantRole = await registry.grantRole(PM_ROLE, liquidator.address);
    await txGrantRole.wait();

    dex = process.env.DEX ? process.env.DEX : "uniswap";
    checkIsDexSupported(dex);

    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
    routesForClose = await getSingleRoute([testTokenB.address, testTokenA.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    tokenUSD = await getContract("USD Coin");
    decimalsUSD = await tokenUSD.decimals();
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_PMX", deployer.address);
    priceFeedTTBETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_ETH", deployer.address);
    priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    const ttaPriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);

    const priceFeedUSDETH = await PrimexAggregatorV3TestServiceFactory.deploy("USD_ETH", deployer.address);
    const usdPriceInETH = parseUnits("0.0005", "18"); // 1 usd=0.0005 eth
    await priceFeedUSDETH.setDecimals("18");
    await priceFeedUSDETH.setAnswer(usdPriceInETH);

    const priceFeedPMXETH = await PrimexAggregatorV3TestServiceFactory.deploy("USD_PMX", deployer.address);
    const usdPriceInPMX = parseUnits("0.01", "18"); // 1 eth=100 pmx
    await priceFeedPMXETH.setDecimals("18");
    await priceFeedPMXETH.setAnswer(usdPriceInPMX);

    const decimalsPMX = await PMXToken.decimals();
    await priceFeedTTAPMX.setDecimals(decimalsPMX);
    const ttaPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 tta=0.2 pmx
    await priceFeedTTAPMX.setAnswer(ttaPriceInPMX);

    await priceFeedTTBETH.setAnswer(parseUnits("10000", decimalsUSD));
    await priceFeedTTBETH.setDecimals(decimalsUSD);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals(decimalsA);

    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenA.address, PMXToken.address, priceFeedTTAPMX.address);
    await priceOracle.updatePriceFeed(testTokenA.address, NATIVE_CURRENCY, priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, NATIVE_CURRENCY, priceFeedTTBETH.address);
    await priceOracle.updatePriceFeed(tokenUSD.address, NATIVE_CURRENCY, priceFeedUSDETH.address);
    await priceOracle.updatePriceFeed(PMXToken.address, NATIVE_CURRENCY, priceFeedPMXETH.address);

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    depositedAmount = parseUnits("15", decimalsA);
    borrowedAmount = parseUnits("25", decimalsA);
    swapSize = depositedAmount.add(borrowedAmount);

    const feeAmountCalculateWithETHRate = wadMul(swapSize.mul(multiplierA), await PrimexDNS.protocolRate());
    feeAmountInEth = wadMul(feeAmountCalculateWithETHRate, ttaPriceInETH);

    const lenderAmount = parseUnits("50", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
    await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
    const deadline = new Date().getTime() + 600;

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: firstAssetRoutes.concat(),
      depositedAsset: testTokenA.address,
      depositedAmount: depositedAmount,
      isProtocolFeeInPmx: false,
      tokenToBuy: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      closeConditions: [],
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const price0 = wadDiv(swap, amountB);
    price = price0.div(multiplierA);
    await priceFeed.setAnswer(price);

    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();
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
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: firstAssetRoutes.concat(),
      depositedAsset: testTokenA.address,
      depositedAmount: depositedAmount,
      isProtocolFeeInPmx: false,
      tokenToBuy: testTokenB.address,
      amountOutMin: 0,
      deadline: new Date().getTime() + 600,
      takeDepositFromWallet: true,
      closeConditions: [],
    };
  });

  it("Should close position by stop loss condition and NOT update keeper balance because the closing happens in the same block", async function () {
    const conditionIndex = 0;
    const stopLossPrice = BigNumber.from(price.mul(multiplierA)).sub("1").toString();
    const takeProfitPrice = BigNumber.from(price.mul(multiplierA)).add("1").toString();

    OpenPositionParams.closeConditions = [
      getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
    ];
    const positionId = await positionManager.positionsId();
    await positionManager.connect(trader).openPosition(OpenPositionParams, { value: feeAmountInEth });
    const latestTimeStamp = (await provider.getBlock("latest")).timestamp;
    await network.provider.send("evm_setNextBlockTimestamp", [latestTimeStamp]);

    const { updatedConditionsAt } = await positionManager.getPosition(positionId);

    const reducedPriceFeedPrice = BigNumber.from(price).sub(2);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );

    await priceFeed.setAnswer(reducedPriceFeedPrice);

    await positionManager
      .connect(liquidator)
      .closePositionByCondition(0, liquidator.address, routesForClose, conditionIndex, "0x", CloseReason.LIMIT_CONDITION);
    expect(updatedConditionsAt).to.be.equal(latestTimeStamp);

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.equal(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.equal(0);
  });

  it("Should close position by take profit condition and NOT update keeper balance because the closing happens in the same block", async function () {
    const conditionIndex = 0;

    const stopLossPrice = BigNumber.from(price).sub("1").toString();
    const takeProfitPrice = BigNumber.from(price).add("1").toString();

    OpenPositionParams.closeConditions = [
      getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
    ];
    const positionId = await positionManager.positionsId();
    await positionManager.connect(trader).openPosition(OpenPositionParams, { value: feeAmountInEth });
    const createPositionAt = (await provider.getBlock("latest")).timestamp;

    await network.provider.send("evm_setNextBlockTimestamp", [createPositionAt]);
    await swapExactTokensForTokens({
      dex: dex,
      amountIn: parseEther("50", decimalsA),
      path: [testTokenA.address, testTokenB.address],
    });
    const { updatedConditionsAt } = await positionManager.getPosition(positionId);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    await network.provider.send("evm_setNextBlockTimestamp", [createPositionAt]);
    await positionManager
      .connect(liquidator)
      .closePositionByCondition(
        0,
        liquidator.address,
        routesForClose,
        conditionIndex,
        getTakeProfitStopLossAdditionalParams(routesForClose),
        CloseReason.LIMIT_CONDITION,
      );

    const latestTimeStamp = (await provider.getBlock("latest")).timestamp;

    expect(updatedConditionsAt).to.be.equal(latestTimeStamp);

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.equal(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.equal(0);
  });

  it("Should batch close position by SL and update keeper balance", async function () {
    const batchManager = await getContract("BatchManager");

    const stopLossPrice = BigNumber.from(price.mul(multiplierA)).sub("1").toString();
    const takeProfitPrice = BigNumber.from(price.mul(multiplierA)).add("1").toString();
    const closeRoute = await getSingleRoute([testTokenB.address, testTokenA.address], dex);

    OpenPositionParams.closeConditions = [
      getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
    ];

    const positionId = await positionManager.positionsId();
    await positionManager.connect(trader).openPosition(OpenPositionParams, { value: feeAmountInEth });
    const { positionAmount } = await positionManager.getPosition(positionId);
    const createPositionAt = (await provider.getBlock("latest")).timestamp;

    await network.provider.send("evm_setNextBlockTimestamp", [createPositionAt]);
    await swapExactTokensForTokens({
      dex: dex,
      amountIn: positionAmount,
      path: [testTokenB.address, testTokenA.address],
    });

    await network.provider.send("evm_setNextBlockTimestamp", [createPositionAt]);
    await positionManager.connect(trader).openPosition(OpenPositionParams, { value: feeAmountInEth });
    const { updatedConditionsAt: timestampOfFirstPosition } = await positionManager.getPosition(positionId);
    const { updatedConditionsAt: timestampOfSecondPosition } = await positionManager.getPosition(positionId.add("1"));

    const reducedPriceFeedPrice = BigNumber.from(price).sub(2);

    await priceFeed.setAnswer(reducedPriceFeedPrice);
    await network.provider.send("evm_setNextBlockTimestamp", [createPositionAt]);
    await swapExactTokensForTokens({
      dex: dex,
      amountIn: swapSize,
      path: [testTokenA.address, testTokenB.address],
    });

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    await network.provider.send("evm_setNextBlockTimestamp", [createPositionAt]);
    await batchManager
      .connect(liquidator)
      .closeBatchPositions([0, 1], closeRoute, testTokenB.address, testTokenA.address, bucketAddress, [0, 0], CloseReason.BATCH_STOP_LOSS);

    const latestTimeStamp = (await provider.getBlock("latest")).timestamp;
    expect(timestampOfFirstPosition).to.be.equal(timestampOfSecondPosition).to.be.equal(latestTimeStamp);

    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.equal(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.equal(0);
  });

  it("Should open position by order and update keeper activity", async function () {
    const deadline = new Date().getTime() + 600;
    const takeDepositFromWallet = true;
    await testTokenA.mint(trader.address, depositedAmount);
    await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256);
    const slPrice = 0;
    const tpPrice = 0;
    const limitPrice = price.mul(2);
    const positionAsset = testTokenB.address;
    const leverage = parseEther("2");

    await limitOrderManager.connect(trader).createLimitOrder(
      {
        bucket: "bucket1",
        depositedAsset: testTokenA.address,
        depositedAmount: depositedAmount,
        positionAsset: positionAsset,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
      },
      { value: feeAmountInEth },
    );
    const openPositionAt = (await provider.getBlock("latest")).timestamp;

    const orderId = await limitOrderManager.ordersId();

    const { updatedConditionsAt } = await limitOrderManager.getOrder(orderId);

    await network.provider.send("evm_setNextBlockTimestamp", [openPositionAt]);
    await priceFeed.setAnswer(limitPrice);

    const { pmxBalance: pmxRewardBefore, nativeBalance: nativeRewardBefore } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );

    const defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);

    await network.provider.send("evm_setNextBlockTimestamp", [openPositionAt]);
    await limitOrderManager.connect(liquidator).openPositionByOrder({
      orderId: orderId,
      conditionIndex: 0,
      comAdditionalParams: defaultAdditionalParams,
      firstAssetRoutes: firstAssetRoutes,
      depositInThirdAssetRoutes: [],
      keeper: liquidator.address,
    });
    const latestTimeStamp = (await provider.getBlock("latest")).timestamp;
    expect(latestTimeStamp).to.be.equal(updatedConditionsAt);
    const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await KeeperRewardDistributor.keeperBalance(
      liquidator.address,
    );
    expect(pmxRewardAfter.sub(pmxRewardBefore)).to.be.equal(0);
    expect(nativeRewardAfter.sub(nativeRewardBefore)).to.be.equal(0);
  });
}
/* eslint-disable */
network.config.allowBlocksWithSameTimestamp
  ? describe("ExecutionsInOneBlock_integration", tests)
  : describe.skip("ExecutionsInOneBlock_integration", tests);
