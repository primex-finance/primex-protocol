// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { getTakeProfitStopLossParams, getTakeProfitStopLossAdditionalParams, getCondition } = require("../utils/conditionParams");

const { getAmountsOut, addLiquidity, getSingleRoute } = require("../utils/dexOperations");

const { TAKE_PROFIT_STOP_LOSS_CM_TYPE, MAX_TOKEN_DECIMALITY, NATIVE_CURRENCY } = require("../utils/constants");

const { wadDiv } = require("../utils/math");

process.env.TEST = true;

describe("TakeProfitStopLossCCM_integration", function () {
  let snapshotId;
  let trader, lender, deployer;
  let primexDNS,
    priceOracle,
    limitOrderManager,
    positionLibrary,
    primexPricingLibrary,
    registry,
    testTokenA,
    testTokenB,
    bucket,
    priceFeed,
    traderBalanceVault,
    positionManager,
    primexLens,
    takeProfitStopLossCCM,
    pmAddress,
    ErrorsLibrary,
    decimalsA,
    decimalsB,
    multiplierA,
    multiplierB;
  let assetRoutes, assetRoutesForClose, dex, bucketAddress;

  before(async function () {
    await fixture(["Test"]);
    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }

    ({ deployer, trader, lender } = await getNamedSigners());
    takeProfitStopLossCCM = await getContract("TakeProfitStopLossCCM");
    primexDNS = await getContract("PrimexDNS");
    priceOracle = await getContract("PriceOracle");
    limitOrderManager = await getContract("LimitOrderManager");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    positionLibrary = await getContract("PositionLibrary");
    registry = await getContract("Registry");
    traderBalanceVault = await getContract("TraderBalanceVault");
    primexLens = await getContract("PrimexLens");
    positionManager = await getContract("PositionManager");
    ErrorsLibrary = await getContract("Errors");
    pmAddress = positionManager.address;

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();

    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
    assetRoutesForClose = await getSingleRoute([testTokenB.address, testTokenA.address], dex);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    await priceFeedTTAETH.setDecimals("18");

    const ttaPriceInETH = parseUnits("0.3", 18); // 1 tta=0.3 ETH
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
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

  describe("constructor", function () {
    it("Should initialize with correct values", async function () {
      expect(await takeProfitStopLossCCM.primexDNS()).to.equal(primexDNS.address);
      expect(await takeProfitStopLossCCM.priceOracle()).to.equal(priceOracle.address);
    });

    it("Should revert when initialized with wrong primexDNS address", async function () {
      const wrongAddress = registry.address;
      await expect(
        run("deploy:TakeProfitStopLossCCM", {
          registry: registry.address,
          primexDNS: wrongAddress,
          priceOracle: priceOracle.address,
          primexPricingLibrary: primexPricingLibrary.address,
          positionLibrary: positionLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong priceOracle address", async function () {
      const wrongAddress = registry.address;
      await expect(
        run("deploy:TakeProfitStopLossCCM", {
          registry: registry.address,
          primexDNS: primexDNS.address,
          priceOracle: wrongAddress,
          limitOrderManager: limitOrderManager.address,
          primexPricingLibrary: primexPricingLibrary.address,
          positionLibrary: positionLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("canBeClosed", function () {
    let borrowedAmount,
      lenderAmount,
      depositAmount,
      amountOutMin,
      deadline,
      takeDepositFromWallet,
      snapshotId,
      exchangeRate,
      exchangeRateInWadDecimals;

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

      await bucket.connect(lender).deposit(lender.address, lenderAmount);

      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
        value: parseEther("1"),
      });

      const swapSize = depositAmount.add(borrowedAmount);
      const swapSizeInWadDecimalss = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountOutInWadDecimals = amount0Out.mul(multiplierB);

      exchangeRateInWadDecimals = BigNumber.from(wadDiv(swapSizeInWadDecimalss.toString(), amountOutInWadDecimals.toString()).toString());
      exchangeRate = exchangeRateInWadDecimals.div(multiplierA);
      await priceFeed.setAnswer(exchangeRate);
      await priceFeed.setDecimals(decimalsA);
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

    it("should return 'false' when stopLossPrice and takeProfitPrice is zero", async function () {
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
        closeConditions: [],
      });
      const additionalParams = getTakeProfitStopLossAdditionalParams(assetRoutesForClose);
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.be.equal(false);
      expect(await primexLens.callStatic.isTakeProfitReached(pmAddress, 0, assetRoutesForClose)).to.be.equal(false);
      await expect(positionManager.connect(trader).callStatic.canBeClosed(0, 0, additionalParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CONDITION_INDEX_IS_OUT_OF_BOUNDS",
      );
    });

    it("isStopLossReached should return 'false' when stopLossPrice < oracle price", async function () {
      const stopLossPrice = exchangeRate.sub(1).mul(multiplierA);
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
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
      });
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.be.equal(false);
    });
    it("isStopLossReached should return 'true' when oracle price <= stopLossPrice", async function () {
      const stopLossPrice = exchangeRateInWadDecimals;
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
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
      });
      // when stopLossPrice == exchangeRateInWadDecimals
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.be.equal(true);
      // when stopLossPrice > exchangeRateInWadDecimals;
      await priceFeed.setAnswer(exchangeRate.div("2"));
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.be.equal(true);
    });
    it("isTakeProfitReached should return 'false' when takeProfitPrice >= oracle price", async function () {
      const takeProfitAmount = borrowedAmount.add(depositAmount);
      const positionAmount = await getAmountsOut(dex, takeProfitAmount, [testTokenA.address, testTokenB.address]);
      const takeProfitPrice = wadDiv(takeProfitAmount.toString(), positionAmount.toString()).toString();
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
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
      });

      expect(await primexLens.callStatic.isTakeProfitReached(pmAddress, 0, assetRoutesForClose)).to.be.equal(false);
    });
    it("isTakeProfitReached should return 'true' when takeProfitPrice is lower market price", async function () {
      const swapSize = depositAmount.add(borrowedAmount);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const liquidationPrice = await primexPricingLibrary.getLiquidationPrice(
        bucketAddress,
        testTokenB.address,
        amount0Out,
        borrowedAmount,
      );
      const takeProfitPrice = liquidationPrice.add(1).mul(multiplierA);

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
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
      });

      expect(await primexLens.callStatic.isTakeProfitReached(pmAddress, 0, assetRoutesForClose)).to.be.equal(true);
    });
  });
});
