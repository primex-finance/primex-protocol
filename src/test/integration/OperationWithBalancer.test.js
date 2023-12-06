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
    utils: { parseUnits, parseEther },
    constants: { MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const { addLiquidity, checkIsDexSupported, getAmountsOut, getEncodedPath, getSingleRoute } = require("../utils/dexOperations");
const { wadDiv, wadMul } = require("../utils/math");
const { MAX_TOKEN_DECIMALITY, USD, OrderType, NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

describe("Operation with the Balancer dex_integration", function () {
  let dex,
    positionManager,
    testTokenA,
    testTokenB,
    bucket,
    testTokenX,
    testTokenY,
    PrimexDNS,
    bucketAddress,
    dexRouter,
    dexAdapter,
    priceFeedTTATTX,
    priceFeedTTATTY,
    depositAmount,
    borrowedAmount,
    amountOutMin,
    swapSize,
    takeDepositFromWallet,
    deadline,
    routesForCloseBA,
    routesForCloseXA,
    assetRoutesAB,
    assetRoutesAX;
  let priceFeed, priceOracle, feeAmountInEth;
  let deployer, trader, lender;
  let snapshotIdBase;
  let decimalsA, decimalsB, decimalsX;
  let multiplierA, multiplierB, multiplierX;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    dexAdapter = await getContract("DexAdapter");
    positionManager = await getContract("PositionManager");
    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    dex = "balancer";
    checkIsDexSupported(dex);

    dexRouter = (await PrimexDNS.dexes(dex)).routerAddress;

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([deployer.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    decimalsX = await testTokenX.decimals();

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);
    await positionManager.setMaxPositionSize(testTokenA.address, testTokenX.address, 0, MaxUint256);

    await run("deploy:ERC20Mock", {
      name: "TestTokenY",
      symbol: "TTY",
      decimals: "18",
      initialAccounts: JSON.stringify([deployer.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenY = await getContract("TestTokenY");

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);
    await priceFeed.setAnswer(1);
    await priceFeed.setDecimals(decimalsB);

    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    priceFeedTTATTX = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTA_TTX", deployer.address);
    priceFeedTTATTY = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTA_TTY", deployer.address);
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_NATIVE", deployer.address);
    const ttaPriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);

    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenX.address, priceFeedTTATTX.address);
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenY.address, priceFeedTTATTY.address);

    const pairPriceDrop = parseEther("0.01");

    await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);
    await priceOracle.setPairPriceDrop(testTokenY.address, testTokenA.address, pairPriceDrop);
    await priceOracle.updatePriceFeed(testTokenX.address, USD, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenY.address, USD, priceFeed.address);

    await bucket.addAsset(testTokenX.address);
    await bucket.addAsset(testTokenY.address);

    const lenderAmount = parseUnits("50", decimalsA);
    depositAmount = parseUnits("6", decimalsA);
    borrowedAmount = parseUnits("10", decimalsA);
    amountOutMin = 0;
    takeDepositFromWallet = true;
    deadline = new Date().getTime() + 600;
    await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

    const feeAmountCalculateWithETHRate = wadMul(
      borrowedAmount.add(depositAmount).toString(),
      (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
    ).toString();
    feeAmountInEth = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    swapSize = depositAmount.add(borrowedAmount);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("For a pool with 3 tokens", function () {
    let snapshotId, pool;
    before(async function () {
      pool = await addLiquidity({
        dex: dex,
        from: "deployer",
        assets: [
          { token: testTokenA.address, weight: "3", amount: "100" },
          { token: testTokenB.address, weight: "3", amount: "100" },
          { token: testTokenX.address, weight: "4", amount: "100" },
        ],
      });
      assetRoutesAB = await getSingleRoute([testTokenA.address, testTokenB.address], dex, 1, [pool]);
      assetRoutesAX = await getSingleRoute([testTokenA.address, testTokenX.address], dex, 1, [pool]);
      routesForCloseBA = await getSingleRoute([testTokenB.address, testTokenA.address], dex, 1, [pool]);
      routesForCloseXA = await getSingleRoute([testTokenX.address, testTokenA.address], dex, 1, [pool]);
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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
    it("Should return correct getAmountsOut", async function () {
      const tokenBAmount = await dexAdapter.callStatic.getAmountsOut({
        encodedPath: await getEncodedPath([testTokenA.address, testTokenB.address], dex, [pool]),
        amount: parseUnits("1", decimalsA),
        dexRouter: dexRouter,
      });
      const tokenXAmount = await dexAdapter.callStatic.getAmountsOut({
        encodedPath: await getEncodedPath([testTokenA.address, testTokenX.address], dex, [pool]),
        amount: parseUnits("2", decimalsA),
        dexRouter: dexRouter,
      });

      const expectedBAmount = await getAmountsOut(dex, parseUnits("1", decimalsA), [testTokenA.address, testTokenB.address], [pool]);
      const expectedXAmount = await getAmountsOut(dex, parseUnits("2", decimalsA), [testTokenA.address, testTokenX.address], [pool]);

      expect(tokenBAmount[1]).to.be.equal(expectedBAmount);
      expect(tokenXAmount[1]).to.be.equal(expectedXAmount);
    });
    it("Should open position and increase position count when positionAsset is testTokenB", async function () {
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAB,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close position and decrease position count when positionAsset is testTokenB", async function () {
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAB,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      const { positionAmount } = await positionManager.getPosition(0);
      const amountAOut = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address], [pool]);

      const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
      const positionAmountInWadDecimals = positionAmount.mul(multiplierB);

      let price = wadDiv(amountAOutInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);
      await priceFeed.setDecimals(decimalsA);

      await positionManager.connect(trader).closePosition(0, trader.address, routesForCloseBA, 0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should open a position and increase position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);

      const swapSizeInWadDecimals = swapSize.mul(multiplierA);
      const amount0OutInWadDecimals = amount0Out.mul(multiplierX);

      let limitPrice = wadDiv(amount0OutInWadDecimals.toString(), swapSizeInWadDecimals.toString()).toString();
      limitPrice = BigNumber.from(limitPrice).div(multiplierX);

      await priceFeedTTATTX.setAnswer(limitPrice);
      await priceFeedTTATTX.setDecimals(decimalsX);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAX,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenX.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close a position and decrease position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);

      const swapSizeInWadDecimals = swapSize.mul(multiplierA);
      const amount0OutInWadDecimals = amount0Out.mul(multiplierX);

      let limitPrice = wadDiv(amount0OutInWadDecimals.toString(), swapSizeInWadDecimals.toString()).toString();
      limitPrice = BigNumber.from(limitPrice).div(multiplierX);

      await priceFeedTTATTX.setAnswer(limitPrice);
      await priceFeedTTATTX.setDecimals(decimalsX);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAX,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenX.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await positionManager.connect(trader).closePosition(0, trader.address, routesForCloseXA, 0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });
  });

  describe("For a pool with 4 tokens", function () {
    let snapshotId, pool;
    before(async function () {
      pool = await addLiquidity({
        dex: dex,
        from: "deployer",
        assets: [
          { token: testTokenA.address, weight: "3", amount: "100" },
          { token: testTokenB.address, weight: "3", amount: "100" },
          { token: testTokenY.address, weight: "2", amount: "100" },
          { token: testTokenX.address, weight: "2", amount: "100" },
        ],
      });

      assetRoutesAB = await getSingleRoute([testTokenA.address, testTokenB.address], dex, 1, [pool]);
      routesForCloseBA = await getSingleRoute([testTokenB.address, testTokenA.address], dex, 1, [pool]);
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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
    it("Should return correct getAmountsOut", async function () {
      const tokenBAmount = await dexAdapter.callStatic.getAmountsOut({
        encodedPath: await getEncodedPath([testTokenA.address, testTokenB.address], dex, [pool]),
        amount: parseUnits("1", decimalsA),
        dexRouter: dexRouter,
      });
      const tokenXAmount = await dexAdapter.callStatic.getAmountsOut({
        encodedPath: await getEncodedPath([testTokenA.address, testTokenX.address], dex, [pool]),
        amount: parseUnits("2", decimalsA),
        dexRouter: dexRouter,
      });

      const expectedBAmount = await getAmountsOut(dex, parseUnits("1", decimalsA), [testTokenA.address, testTokenB.address], [pool]);
      const expectedXAmount = await getAmountsOut(dex, parseUnits("2", decimalsA), [testTokenA.address, testTokenX.address], [pool]);

      expect(tokenBAmount[1]).to.be.equal(expectedBAmount);
      expect(tokenXAmount[1]).to.be.equal(expectedXAmount);
    });

    it("Should open position and increase position count when positionAsset is testTokenB", async function () {
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAB,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close position and decrease position count when positionAsset is testTokenB", async function () {
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAB,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      const { positionAmount } = await positionManager.getPosition(0);
      const amountAOut = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address], [pool]);

      const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
      const positionAmountInWadDecimals = positionAmount.mul(multiplierB);

      let price = wadDiv(amountAOutInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);
      await priceFeed.setDecimals(decimalsA);

      await positionManager.connect(trader).closePosition(0, trader.address, routesForCloseBA, 0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should open a position and increase position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const swapSizeInWadDecimals = swapSize.mul(multiplierA);
      const amount0OutInWadDecimals = amount0Out.mul(multiplierX);
      let limitPrice = wadDiv(amount0OutInWadDecimals.toString(), swapSizeInWadDecimals.toString()).toString();
      limitPrice = BigNumber.from(limitPrice).div(multiplierX);
      await priceFeedTTATTX.setAnswer(limitPrice);
      await priceFeedTTATTX.setDecimals(decimalsX);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAX,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenX.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close a position and decrease position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const swapSizeInWadDecimals = swapSize.mul(multiplierA);
      const amount0OutInWadDecimals = amount0Out.mul(multiplierX);
      let limitPrice = wadDiv(amount0OutInWadDecimals.toString(), swapSizeInWadDecimals.toString()).toString();
      limitPrice = BigNumber.from(limitPrice).div(multiplierX);
      await priceFeedTTATTX.setAnswer(limitPrice);
      await priceFeedTTATTX.setDecimals(decimalsX);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetRoutesAX,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenX.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await positionManager.connect(trader).closePosition(0, trader.address, routesForCloseXA, 0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });
  });
});
