// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseUnits, parseEther },
    constants: { MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const { addLiquidity, checkIsDexSupported, getAmountsOut, getEncodedPath, getSingleMegaRoute } = require("../utils/dexOperations");
const { wadDiv } = require("../utils/math");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
const { MAX_TOKEN_DECIMALITY, USD_DECIMALS, USD_MULTIPLIER } = require("../utils/constants");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("../utils/oracleUtils");

process.env.TEST = true;

describe("Operation with the Balancer dex_integration", function () {
  let dex,
    positionManager,
    testTokenA,
    testTokenB,
    bucket,
    testTokenX,
    testTokenY,
    ttaPriceInETH,
    PrimexDNS,
    bucketAddress,
    dexRouter,
    dexAdapter,
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
  let priceOracle;
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

    const { payload: payload1 } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload1);
    const { payload: payload2 } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenX.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload2);

    await run("deploy:ERC20Mock", {
      name: "TestTokenY",
      symbol: "TTY",
      decimals: "18",
      initialAccounts: JSON.stringify([deployer.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenY = await getContract("TestTokenY");

    priceOracle = await getContract("PriceOracle");

    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenY, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    const pairPriceDrop = parseEther("0.01");

    await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);
    await priceOracle.setPairPriceDrop(testTokenY.address, testTokenA.address, pairPriceDrop);

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
        dex: "balancer",
        from: "deployer",
        assets: [
          { token: testTokenA.address, weight: "3", amount: "100" },
          { token: testTokenB.address, weight: "3", amount: "100" },
          { token: testTokenX.address, weight: "4", amount: "100" },
        ],
      });
      assetRoutesAB = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex, [pool]);
      assetRoutesAX = await getSingleMegaRoute([testTokenA.address, testTokenX.address], dex, [pool]);
      routesForCloseBA = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex, [pool]);
      routesForCloseXA = await getSingleMegaRoute([testTokenX.address, testTokenA.address], dex, [pool]);
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
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address], [pool]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAB,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close position and decrease position count when positionAsset is testTokenB", async function () {
      const deadline = new Date().getTime() + 600;
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address], [pool]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAB,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routesForCloseBA,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should open a position and increase position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const amountX = amount0Out.mul(multiplierX);
      const swap = swapSize.mul(multiplierA);
      const limitPrice = wadDiv(amountX.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenX, price0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAX,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenX.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close a position and decrease position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const amountX = amount0Out.mul(multiplierX);
      const swap = swapSize.mul(multiplierA);
      const limitPrice = wadDiv(amountX.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenX, price0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAX,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenX.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routesForCloseXA,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenX),
          getEncodedChainlinkRouteViaUsd(testTokenX),
          [],
        );

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

      assetRoutesAB = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex, [pool]);
      assetRoutesAX = await getSingleMegaRoute([testTokenA.address, testTokenX.address], dex, [pool]);
      routesForCloseBA = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex, [pool]);
      routesForCloseXA = await getSingleMegaRoute([testTokenX.address, testTokenA.address], dex, [pool]);
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

      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address], [pool]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAB,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close position and decrease position count when positionAsset is testTokenB", async function () {
      const deadline = new Date().getTime() + 600;

      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address], [pool]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAB,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routesForCloseBA,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should open a position and increase position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const amountX = amount0Out.mul(multiplierX);
      const swap = swapSize.mul(multiplierA);
      const limitPrice = wadDiv(amountX.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenX, price0);
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAX,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenX.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close a position and decrease position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const amountX = amount0Out.mul(multiplierX);
      const swap = swapSize.mul(multiplierA);
      const limitPrice = wadDiv(amountX.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenX, price0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutesAX,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenX.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routesForCloseXA,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenX),
          getEncodedChainlinkRouteViaUsd(testTokenX),
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });
  });
});
