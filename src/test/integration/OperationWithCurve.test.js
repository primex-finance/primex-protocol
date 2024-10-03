// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits, getAddress, defaultAbiCoder },
    constants: { MaxUint256, AddressZero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const { addLiquidity, checkIsDexSupported, getAmountsOut, getEncodedPath, getSingleMegaRoute } = require("../utils/dexOperations");
const { wadDiv } = require("../utils/math");
const { deployMockReserve, deployMockWhiteBlackList } = require("../utils/waffleMocks");
const { MAX_TOKEN_DECIMALITY, BAR_CALC_PARAMS_DECODE, USD_DECIMALS, USD_MULTIPLIER } = require("../utils/constants");
const { barCalcParams } = require("../utils/defaultBarCalcParams");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("../utils/oracleUtils");

process.env.TEST = true;

describe("Operation with the Curve dex_integration", function () {
  let dex,
    positionManager,
    testTokenA,
    testTokenB,
    testTokenX,
    decimalsA,
    decimalsB,
    decimalsX,
    bucketCurve,
    bucketNameCurve,
    bucketAddressCurve,
    PrimexDNS,
    dexRouter,
    dexAdapter,
    routesForCloseBA,
    routesForCloseXA,
    assetRoutesAB,
    assetRoutesAX,
    interestRateStrategy;
  let priceOracle;
  let deployer, trader, lender;
  let snapshotIdBase;
  let multiplierA, multiplierB, multiplierX;
  let tokenTransfersLibrary;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    const mockReserve = await deployMockReserve(deployer);
    const mockWhiteBlackList = await deployMockWhiteBlackList(deployer);

    interestRateStrategy = await getContract("InterestRateStrategy");
    PrimexDNS = await getContract("PrimexDNS");
    dexAdapter = await getContract("DexAdapter");
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");

    dex = "curve";
    checkIsDexSupported(dex);

    dexRouter = await PrimexDNS.getDexAddress(dex);
    // Pool for USDT/WBTC/WETH or similar
    // The curve pool needs tokens with non-standard decimals
    await run("deploy:ERC20Mock", {
      name: "testTokenA_curve",
      symbol: "TTA",
      decimals: "18",
      initialAccounts: JSON.stringify([]),
      initialBalances: JSON.stringify([]),
    });
    testTokenA = await getContract("testTokenA_curve");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseEther("100"));

    await run("deploy:ERC20Mock", {
      name: "testTokenB_curve",
      symbol: "TTB",
      decimals: "8",
      initialAccounts: JSON.stringify([deployer.address]),
      initialBalances: JSON.stringify([parseUnits("100000", 8).toString()]),
    });
    testTokenB = await getContract("testTokenB_curve");
    decimalsB = await testTokenB.decimals();

    // A dedicated bucket is deployed for Curve with unchangeable decimality (18) of underlyingAsset tokenA
    bucketNameCurve = "bucketCurve";
    const assets = [testTokenB.address];
    const risksThreshold = "100000000000000000";
    const underlyingAsset = testTokenA.address;
    const feeBuffer = "1000200000000000000"; // 1.0002
    const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
    const reserveRate = "100000000000000000"; // 0.1 - 10%
    const BucketsFactory = await getContract("BucketsFactoryV2");
    const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
    const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

    await priceOracle.setPairPriceDrop(testTokenB.address, testTokenA.address, risksThreshold);

    const txCreateBucket = await BucketsFactory.createBucket({
      nameBucket: bucketNameCurve,
      positionManager: positionManager.address,
      priceOracle: priceOracle.address,
      dns: PrimexDNS.address,
      reserve: mockReserve.address,
      tokenTransfersLibrary: tokenTransfersLibrary.address,
      assets: assets,
      underlyingAsset: underlyingAsset,
      feeBuffer: feeBuffer,
      whiteBlackList: mockWhiteBlackList.address,
      withdrawalFeeRate: withdrawalFeeRate,
      reserveRate: reserveRate,
      liquidityMiningRewardDistributor: AddressZero,
      liquidityMiningAmount: 0,
      liquidityMiningDeadline: 0,
      stabilizationDuration: 0,
      interestRateStrategy: interestRateStrategy.address,
      maxAmountPerUser: 0,
      estimatedBar: estimatedBar,
      estimatedLar: estimatedLar,
      barCalcParams: defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]),
      maxTotalDeposit: MaxUint256,
    });

    const txCreateBucketReceipt = await txCreateBucket.wait();

    for (let i = 0; i < txCreateBucketReceipt.events.length; i++) {
      if (txCreateBucketReceipt.events[i].event === "BucketCreated") {
        bucketAddressCurve = getAddress("0x" + txCreateBucketReceipt.events[i].data.slice(26));
      }
    }
    await PrimexDNS.addBucket(bucketAddressCurve, 0);
    bucketCurve = await getContractAt("Bucket", bucketAddressCurve);

    await run("deploy:ERC20Mock", {
      name: "testTokenX_curve",
      symbol: "TTX",
      decimals: "6",
      initialAccounts: JSON.stringify([deployer.address]),
      initialBalances: JSON.stringify([parseUnits("100000", 6).toString()]),
    });
    testTokenX = await getContract("testTokenX_curve");
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

    priceOracle = await getContract("PriceOracle");

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH
    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("For a pool with 3 tokens", function () {
    let snapshotId;
    let depositAmount, borrowedAmount, amountOutMin, takeDepositFromWallet, swapSize, deadline, pool;
    before(async function () {
      deadline = new Date().getTime() + 600;
      pool = await addLiquidity({
        dex: dex,
        from: "deployer",
        assets: [
          { token: testTokenX.address, amount: "102490" },
          { token: testTokenB.address, amount: "3" },
          { token: testTokenA.address, amount: "40" },
        ],
      });

      assetRoutesAB = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex, [pool]);
      assetRoutesAX = await getSingleMegaRoute([testTokenA.address, testTokenX.address], dex, [pool]);
      routesForCloseBA = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex, [pool]);
      routesForCloseXA = await getSingleMegaRoute([testTokenX.address, testTokenA.address], dex, [pool]);

      const lenderAmount = parseEther("50");
      depositAmount = parseEther("1.5");
      borrowedAmount = parseEther("2");
      amountOutMin = 0;
      takeDepositFromWallet = true;

      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await testTokenA.connect(lender).approve(bucketAddressCurve, MaxUint256);

      await bucketCurve.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      const pairPriceDrop = parseEther("0.01");
      await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);

      await bucketCurve.addAsset(testTokenX.address);
      swapSize = depositAmount.add(borrowedAmount);
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
        amount: parseEther("1"),
        dexRouter: dexRouter,
      });
      const tokenXAmount = await dexAdapter.callStatic.getAmountsOut({
        encodedPath: await getEncodedPath([testTokenA.address, testTokenX.address], dex, [pool]),
        amount: parseEther("1"),
        dexRouter: dexRouter,
      });
      const expectedBAmount = await getAmountsOut(dex, parseEther("1"), [testTokenA.address, testTokenB.address], [pool]);
      const expectedXAmount = await getAmountsOut(dex, parseEther("1"), [testTokenA.address, testTokenX.address], [pool]);

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
          bucket: bucketNameCurve,
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
        pullOracleTypes: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should open a position and increase position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const amountX = amount0Out.mul(multiplierX);
      const swap = swapSize.mul(multiplierA);
      const limitPrice = wadDiv(amountX.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenX, price0);

      const deadline = new Date().getTime() + 600;

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: bucketNameCurve,
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
        pullOracleTypes: [],
      });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should close a position and decrease position count when positionAsset is testTokenB", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address], [pool]);
      const swap = swapSize.mul(multiplierA);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: bucketNameCurve,
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
        pullOracleTypes: [],
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
          [],
        );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should close a position and decrease position count when positionAsset is testTokenX", async function () {
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address], [pool]);
      const amountX = amount0Out.mul(multiplierX);
      const swap = swapSize.mul(multiplierA);
      const limitPrice = wadDiv(amountX.toString(), swap.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenX, price0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: bucketNameCurve,
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
        pullOracleTypes: [],
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
          [],
        );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });
  });
});
