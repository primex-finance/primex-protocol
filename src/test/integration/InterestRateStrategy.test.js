// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, Zero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const { BigNumber: BN } = require("bignumber.js");
const { getSingleMegaRoute, checkIsDexSupported, addLiquidity, getAmountsOut } = require("../utils/dexOperations");

const { rayMul, rayDiv, wadMul, wadDiv, calculateBar } = require("../utils/math");
const { WAD, USD_DECIMALS, MAX_TOKEN_DECIMALITY, USD_MULTIPLIER } = require("../utils/constants");
const reserveRate = "100000000000000000"; // 0.1 - 10%
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

describe("InterestRateStrategy_integration", function () {
  let priceOracle, testTokenA, decimalsA, bucket, positionManager, testTokenB, interestRateStrategy, decimalsB, PrimexDNS, dex;
  let testTokenX;
  let multiplierA, multiplierB;
  let deployer, lender, trader;
  let depositAmount;
  let ttaPriceInETH;
  let ErrorsLibrary;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, lender, trader } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    ErrorsLibrary = await getContract("Errors");

    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    interestRateStrategy = await getContractAt("InterestRateStrategy", await bucket.interestRateStrategy());

    positionManager = await getContract("PositionManager");

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([lender.address, deployer.address]),
      initialBalances: JSON.stringify([parseEther("100").toString(), parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");

    dex = process.env.DEX || "uniswap";
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB, tokenC: testTokenX });

    depositAmount = parseUnits("40", decimalsA);
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

    priceOracle = await getContract("PriceOracle");
    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
  });

  describe("calculateInterestRates", function () {
    let snapshotId;
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

    it("Should return correct BAR and LAR for Utilization Ratio = 0%", async function () {
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);
      const debtTokenAddress = await bucket.debtToken();
      const debtToken = await getContractAt("DebtToken", debtTokenAddress);

      const totalDemand = await debtToken.totalSupply();

      expect(totalDemand).to.equal(Zero);
      expect(await bucket.bar()).to.equal(Zero);
      expect(await bucket.lar()).to.equal(Zero);
    });

    it("Should return correct BAR and LAR for Utilization Ratio = 5%", async function () {
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const borrow = parseUnits("5", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      const BAR = calculateBar(uRatio, barCalcParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });

    it("Should return correct BAR and LAR for Utilization Ratio = 20%", async function () {
      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("20", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      const BAR = calculateBar(uRatio, barCalcParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });

    it("Should return correct BAR and LAR for Utilization Ratio = 40%", async function () {
      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("40", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      const BAR = calculateBar(uRatio, barCalcParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });

    it("Should return correct BAR and LAR for Utilization Ratio = 50%", async function () {
      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("50", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      const BAR = calculateBar(uRatio, barCalcParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });

    it("Should return correct BAR and LAR for UR > URoptimal and b1 < 0", async function () {
      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("70", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);

      const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString())); // 70%
      const BAR = calculateBar(uRatio, barCalcParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });

    it("Should revert when BAR overflows", async function () {
      // ur 50% > ur opt 40%
      // b1 < 0
      const barCalcParams2 = { ...barCalcParams };
      barCalcParams2.urOptimal = "400000000000000000000000000"; // 0.40 in ray,
      const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
        nameBucket: "bucket2",
        assets: `["${testTokenB.address}"]`,
        feeBuffer: "1000100000000000000", // 1.0001
        withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
        spread: "994000000000000000", // 0.994
        quasiLinearityRate: "997000000000000000", // 0.997
        reserveRate: "100000000000000000", // 0.1 - 10%,
        underlyingAsset: testTokenA.address,
        liquidityMiningAmount: "0",
        estimatedBar: "100000000000000000000000000", // 0.1 in ray
        estimatedLar: "70000000000000000000000000", // 0.07 in ray
        barCalcParams: JSON.stringify(barCalcParams2),
        maxTotalDeposit: MaxUint256.toString(),
      });
      const newBucket = await getContractAt("Bucket", newBucketAddress);

      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("50", decimalsA);
      await testTokenA.connect(lender).approve(newBucketAddress, MaxUint256);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await newBucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await expect(
        positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket2",
            borrowedAmount: borrow,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BAR_OVERFLOW");
    });

    it("Should return correct BAR and LAR for Utilization Ratio = 1.00", async function () {
      const deposit = parseUnits("50", decimalsA);
      const borrow = parseUnits("50", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = borrow.add(depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      const BAR = calculateBar(uRatio, barCalcParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });

    for (let i = 0.01; i <= 50; i += 4.341) {
      it(`Should return correct BAR and LAR for fractioned Utilization Ratio = ${i.toFixed(3)}%`, async function () {
        const deposit = parseUnits("100", decimalsA);
        const borrow = parseUnits(`${i.toFixed(decimalsA)}`, decimalsA);
        await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

        const amountOutMin = 0;
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenA.connect(trader).approve(positionManager.address, deposit);

        const swapSize = borrow.add(depositAmount);
        const swap = swapSize.mul(multiplierA);
        const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
        const amountB = amount0Out.mul(multiplierB);
        const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
        const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, price);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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
        const uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
        const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
        const BAR = calculateBar(uRatio, barCalcParams);

        expect(await bucket.bar()).to.equal(BAR.toFixed());
      });
    }
    it("BAR, LAR change depending on the accumulation of debt", async function () {
      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("20", decimalsA);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      let swapSize = borrow.add(depositAmount);
      let swap = swapSize.mul(multiplierA);
      let amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      let amountB = amount0Out.mul(multiplierB);
      let limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      let price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      let uRatio = new BN(rayDiv(borrow.toString(), deposit.toString()));
      const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      let BAR = calculateBar(uRatio, barCalcParams);
      let LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());

      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }

      swapSize = borrow.add(depositAmount);
      swap = swapSize.mul(multiplierA);
      amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrow,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
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

      const debtTokenAddress = await bucket.debtToken();
      const debtToken = await getContractAt("DebtToken", debtTokenAddress);

      const totalDemand = await debtToken.totalSupply();
      const availableLiquidity = deposit.sub(borrow.mul(2));
      const totalDeposit = availableLiquidity.add(totalDemand);
      uRatio = new BN(rayDiv(totalDemand.toString(), totalDeposit.toString()));
      BAR = calculateBar(uRatio, barCalcParams);
      LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      expect(await bucket.bar()).to.equal(BAR.toFixed());
      expect(await bucket.lar()).to.equal(LAR.toFixed());
    });
  });
});
