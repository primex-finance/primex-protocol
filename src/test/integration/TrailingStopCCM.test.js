// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  run,
  network,
  ethers: {
    getContract,
    getContractFactory,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { getTrailingStopParams, getTrailingStopAdditionalParams, getCondition } = require("../utils/conditionParams");

const { getAmountsOut, addLiquidity, getSingleRoute } = require("../utils/dexOperations");

const { wadDiv } = require("../utils/math");
const { WAD, MAX_TOKEN_DECIMALITY, CloseReason, TRAILING_STOP_CM_TYPE, USD, NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

describe("TrailingStopCCM_integration", function () {
  let snapshotId;
  let trader, lender, deployer;
  let primexDNS,
    priceOracle,
    testTokenA,
    testTokenB,
    PMXToken,
    bucket,
    priceFeed,
    priceFeedTestTokenAusd,
    priceFeedTestTokenBusd,
    traderBalanceVault,
    positionManager,
    positionLibrary,
    ErrorsLibrary;
  let assetRoutes, dex, bucketAddress;
  let decimalsA, decimalsB, multiplierA, multiplierB;

  before(async function () {
    await fixture(["Test"]);
    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }

    ({ deployer, trader, lender } = await getNamedSigners());
    primexDNS = await getContract("PrimexDNS");
    priceOracle = await getContract("PriceOracle");
    traderBalanceVault = await getContract("TraderBalanceVault");
    positionManager = await getContract("PositionManager");
    positionLibrary = await getContract("PositionLibrary");
    ErrorsLibrary = await getContract("Errors");

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    PMXToken = await getContract("EPMXToken");

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    await run("deploy:PrimexAggregatorV3TestService", { name: "TestTokenA-USD" });
    await run("deploy:PrimexAggregatorV3TestService", { name: "TestTokenB-USD" });

    priceFeedTestTokenAusd = await getContract("PrimexAggregatorV3TestService TestTokenA-USD price feed");
    priceFeedTestTokenBusd = await getContract("PrimexAggregatorV3TestService TestTokenB-USD price feed");
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    await priceFeedTTAETH.setDecimals("18");

    const ttaPriceInETH = parseUnits("0.3", 18); // 1 tta=0.3 ETH
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(await priceOracle.eth(), USD, priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenA.address, USD, priceFeedTestTokenAusd.address);
    await priceOracle.updatePriceFeed(testTokenB.address, USD, priceFeedTestTokenBusd.address);
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

  describe("canBeClosed", function () {
    let borrowedAmount, lenderAmount, depositAmount, amountOutMin, deadline, takeDepositFromWallet, snapshotId, exchangeRate;

    before(async function () {
      lenderAmount = parseUnits("100", decimalsA);
      depositAmount = parseUnits("20", decimalsA);
      borrowedAmount = parseUnits("30", decimalsA);
      amountOutMin = 0;
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = false;

      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
        value: parseEther("1"),
      });

      const swapSize = depositAmount.add(borrowedAmount);
      const swapSizeInWadDecimals = swapSize.mul(multiplierA);
      const amount0Out = (await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address])).mul(multiplierB);
      exchangeRate = BigNumber.from(wadDiv(swapSizeInWadDecimals.toString(), amount0Out.toString()).toString()).div(multiplierA);
      await priceFeed.setAnswer(exchangeRate);
      await priceFeed.setDecimals(decimalsA);

      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenAusd.setDecimals("18");

      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA));
      await priceFeedTestTokenBusd.setDecimals("18");
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

    it("should return 'false' when highPrice < params.activationPrice", async function () {
      const activationPrice = exchangeRate.mul(multiplierA).add(1);
      const trailingDelta = 1;
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(activationPrice, trailingDelta))],
      });

      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA).sub(1));
      const additionalParams = getTrailingStopAdditionalParams([0, 0], [1, 1]);

      expect(await positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.equal(false);
    });

    it("should revert when highPrice base timestamp is before position timestamp", async function () {
      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA).sub(1));

      const activationPrice = exchangeRate.mul(multiplierA).add(1);
      const trailingDelta = 1;
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(activationPrice, trailingDelta))],
      });

      const additionalParams = getTrailingStopAdditionalParams([0, 0], [1, 1]);

      await expect(positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "HIGH_PRICE_TIMESTAMP_IS_INCORRECT",
      );
    });

    it("should revert when highPrice quote timestamp is before position timestamp", async function () {
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA).sub(1));
      const activationPrice = exchangeRate.mul(multiplierA).add(1);
      const trailingDelta = 1;
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(activationPrice, trailingDelta))],
      });
      await priceFeedTestTokenAusd.setAnswer(WAD);
      const additionalParams = getTrailingStopAdditionalParams([0, 0], [1, 1]);

      await expect(positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "HIGH_PRICE_TIMESTAMP_IS_INCORRECT",
      );
    });

    it("should revert when there is no intersection in feed timestamps", async function () {
      const activationPrice = exchangeRate.mul(multiplierA).add(1);
      const trailingDelta = 1;
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(activationPrice, trailingDelta))],
      });
      // create round #1
      await priceFeedTestTokenAusd.setAnswer(exchangeRate.mul(multiplierA).sub(1));
      await priceFeedTestTokenBusd.setAnswer(WAD);
      // create round #2
      await priceFeedTestTokenAusd.setAnswer(exchangeRate.mul(multiplierA).sub(1));
      await priceFeedTestTokenBusd.setAnswer(WAD);
      // create params where high price rounds has no intersection - round #0 and round #2
      const additionalParams = getTrailingStopAdditionalParams([0, 2], [2, 2]);

      await expect(positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NO_PRICE_FEED_INTERSECTION",
      );
    });

    it("should revert when lowPriceRoundNumber is more than latest round", async function () {
      const activationPrice = exchangeRate.mul(multiplierA);
      const trailingDelta = 1;
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(activationPrice, trailingDelta))],
      });
      // create round #1
      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA).add(1));
      // create round #2
      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA).add(1));
      await network.provider.send("evm_mine");
      // create params where low price rounds are more than latest round - [3,3]
      const additionalParams = getTrailingStopAdditionalParams([2, 2], [3, 3]);

      await expect(positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DATA_FOR_ROUND_DOES_NOT_EXIST",
      );
    });

    it("should return true and be able to close position when trailing stop is reached", async function () {
      const activationPrice = exchangeRate.mul(multiplierA).sub(1);
      const trailingDelta = parseEther("1").div(100); // 1%
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(activationPrice, trailingDelta))],
      });
      // create round #1
      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA));
      // create round #2
      await priceFeedTestTokenAusd.setAnswer(WAD);
      await priceFeedTestTokenBusd.setAnswer(exchangeRate.mul(multiplierA).div(2));
      await network.provider.send("evm_mine");

      const additionalParams = getTrailingStopAdditionalParams([1, 1], [2, 2]);

      expect(await positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.equal(true);
      const closeRoute = await getSingleRoute([testTokenB.address, testTokenA.address], dex);
      await expect(
        positionManager
          .connect(trader)
          .closePositionByCondition(0, trader.address, closeRoute, 0, additionalParams, CloseReason.LIMIT_CONDITION, []),
      ).to.emit(positionLibrary.attach(positionManager.address), "ClosePosition");
    });
  });
});
