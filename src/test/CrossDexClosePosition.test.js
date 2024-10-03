// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { WAD, MAX_TOKEN_DECIMALITY, CloseReason, FeeRateType, USD_DECIMALS, USD_MULTIPLIER } = require("./utils/constants");
const { wadDiv, wadMul, rayMul, calculateCompoundInterest } = require("./utils/math");
const { calculateFeeInPaymentAsset } = require("./utils/protocolUtils");
const {
  getAmountsOut,
  addLiquidity,
  swapExactTokensForTokens,
  getPair,
  checkIsDexSupported,
  getSingleMegaRoute,
} = require("./utils/dexOperations");
const { eventValidation } = require("./utils/eventValidation");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  getExchangeRateByRoutes,
  setOraclePrice,
} = require("./utils/oracleUtils");

process.env.TEST = true;

describe("CrossDexClosePosition", function () {
  let dex1, dex2;
  let positionManager, traderBalanceVault, PrimexDNS, bucket, trader, lender, liquidator, pair1, pair2, debtTokenA;
  let testTokenA, testTokenB, PMXToken;
  let decimalsA, decimalsB;
  let priceOracle;
  let snapshotIdBase;
  let routeOnDex1, routeOnDex2;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    ({ trader, lender, liquidator } = await getNamedSigners());
    PrimexDNS = await getContract("PrimexDNS");
    positionManager = await getContract("PositionManager");
    traderBalanceVault = await getContract("TraderBalanceVault");
    ErrorsLibrary = await getContract("Errors");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("1000", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    const debtTokenAddress = await bucket.debtToken();
    debtTokenA = await getContractAt("DebtToken", debtTokenAddress);
    PMXToken = await getContract("EPMXToken");

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex1 = "uniswap";
      dex2 = process.env.DEX;
    } else {
      dex1 = "sushiswap";
      dex2 = "uniswap";
    }
    checkIsDexSupported(dex2);

    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    const pairAddress1 = await getPair(dex1, testTokenA.address, testTokenB.address);
    pair1 = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress1);
    const pairAddress2 = await getPair(dex2, testTokenA.address, testTokenB.address);
    pair2 = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress2);

    priceOracle = await getContract("PriceOracle");
    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    routeOnDex1 = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex1);
    routeOnDex2 = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex2);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("closePosition", function () {
    let snapshotId;
    let depositAmount;
    before(async function () {
      const lenderAmount = parseUnits("50", decimalsA);
      depositAmount = parseUnits("100", decimalsA);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      const borrowedAmount = parseUnits("30", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, depositAmount);

      const swapSize = depositAmount.add(borrowedAmount);
      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const swap = swapSize.mul(multiplierA);

      const amountBOut = await getAmountsOut(dex1, swapSize, [testTokenA.address, testTokenB.address]);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

      const amount0Out = await getAmountsOut(dex1, swapSize, [testTokenA.address, testTokenB.address]);
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
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex1),
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
      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("30", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      }); // position without permanentLoss
      const amountAOut = await getAmountsOut(dex2, amountBOut, [testTokenB.address, testTokenA.address]);
      const amountA = amountAOut.mul(multiplierA);

      const limitPriceDex2 = wadDiv(amountB.toString(), amountA.toString()).toString();
      const priceDex2 = BigNumber.from(limitPriceDex2).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, priceDex2);
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

    it("Shouldn't close position and throw revert if called by the NON-owner", async function () {
      await swapExactTokensForTokens({
        dex: dex1,
        amountIn: parseUnits("5", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const { positionAmount } = await positionManager.getPosition(0);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = positionAmount.mul(multiplierB);

      const amountOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const amountA = amountOut.mul(multiplierA);

      const exchangeRate = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);
      await expect(
        positionManager
          .connect(lender)
          .closePosition(
            0,
            trader.address,
            routeOnDex1,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.be.reverted;
    });

    it("Should revert close position if the dex is frozen in PrimexDNS, but this dex was NOT the dex of opening a position", async function () {
      await PrimexDNS.freezeDEX(dex2);
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEX_NOT_ACTIVE");
    });

    it("Should close position and transfer testTokenB from 'PositionManager' to 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenB, [positionManager, pair1, pair2], [positionAmount.mul(NegativeOne), 0, positionAmount]);
    });

    it("Should close position and transfer testTokenA from 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountAOut = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);

      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenA, [pair1, pair2], [0, amountAOut.mul(NegativeOne)]);
    });

    it("Should close position and delete trader position from traderPositions list", async function () {
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routeOnDex2,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should close position and fully repay traders debt", async function () {
      const borrowedAmount = parseUnits("30", decimalsA);
      expect(await debtTokenA.balanceOf(trader.address)).to.gte(borrowedAmount);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routeOnDex2,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should close position and fully repay traders debt after 1 block past", async function () {
      const borrowedAmount = parseUnits("30", decimalsA);
      await network.provider.send("evm_mine");

      expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routeOnDex2,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should close position and fully repay traders debt after 10 blocks past", async function () {
      const borrowedAmount = parseUnits("30", decimalsA);
      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }

      expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routeOnDex2,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should close position 1 block past and transfer increased full amount (principal + fees) of testTokenA to 'Bucket'", async function () {
      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toFixed());
    });

    it("Should close position 1 block past and rest of trader deposit to traderBalanceVault when deal is loss", async function () {
      await network.provider.send("evm_mine");
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(150);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount } = await positionManager.getPosition(0);

      const amountAOut = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amountAOut,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const restTraderDeposit = amountAOut.sub(positionDebt.toFixed()).sub(feeInPaymentAsset);

      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, traderBalanceVault, restTraderDeposit);

      expect(await testTokenA.balanceOf(positionManager.address)).to.equal(0);
    });

    it("Should close position 1 block past and transfer trader profit from PositionManager to DepositVault when deal is profit", async function () {
      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseEther("130").toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(200);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount } = await positionManager.getPosition(0);
      const amountAOut = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);

      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amountAOut,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const depositAfterDeal = amountAOut.sub(positionDebt.toString()).sub(feeInPaymentAsset);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, traderBalanceVault, depositAfterDeal);

      const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(depositAfterDeal).to.equal(availableBalance);
      expect(0).to.equal(lockedBalance);

      expect(await testTokenA.balanceOf(positionManager.address)).to.equal(0);
      expect(await testTokenB.balanceOf(positionManager.address)).to.equal(0);
    });

    it("Should close position 1 block past and repay to bucket when deal is profit", async function () {
      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseEther("130").toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(250);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );

      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routeOnDex2,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toString());
    });

    it("Should close position 1 block after and add amount to available balance in TraderBalanceVault", async function () {
      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(101);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount } = await positionManager.getPosition(0);

      const amountAOut = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);

      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amountAOut,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routeOnDex2,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableBefore).to.be.equal(0);
      const depositAfterDeal = amountAOut.sub(BigNumber.from(positionDebt.toFixed())).sub(feeInPaymentAsset);
      expect(availableAfter).to.equal(depositAfterDeal);
    });

    it("Should close position and throw event", async function () {
      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(109);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount, depositAmountInSoldAsset } = await positionManager.getPosition(0);

      const amount0Out = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const profit = amount0Out.sub(positionDebt.toString()).sub(depositAmountInSoldAsset).sub(feeInPaymentAsset);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const tx = await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          routeOnDex2,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      const expectedClosePosition = {
        positionI: 0,
        trader: trader.address,
        closedBy: trader.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.CLOSE_BY_TRADER,
      };
      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });
  });

  describe("liquidatePosition", function () {
    let snapshotId;
    before(async function () {
      const lenderAmount = parseUnits("50", decimalsA);
      const depositAmount = parseUnits("20", decimalsA);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
      const borrowedAmount = parseUnits("30", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, depositAmount);

      const swapSize = depositAmount.add(borrowedAmount);
      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const swap = swapSize.mul(multiplierA);

      const amountBOut = await getAmountsOut(dex1, swapSize, [testTokenA.address, testTokenB.address]);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = amountBOut.mul(multiplierB);

      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex1),
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

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("35", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      }); // position without permanentLoss
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

    it("Should liquidate risky position on dex1 if the position is risky", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = positionAmount.mul(multiplierB);

      const bnWAD = BigNumber.from(WAD.toString());

      await swapExactTokensForTokens({
        dex: dex1,
        amountIn: parseUnits("10", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const amountA = amountOut.mul(multiplierA);

      const exchangeRate = wadDiv(amountA.toString(), amountB.toString()).toString();

      const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, price0.toString());

      const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
      const securityBuffer = await positionManager.securityBuffer();

      const feeBuffer = await bucket.feeBuffer();
      const positionDebt = await positionManager.getPositionDebt(0);
      const amount0OutOracle = wadMul(amountB.toString(), priceFromOracle.toString()).toString();
      const numerator = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracle,
      ).toString();
      const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();

      const positionState = wadDiv(numerator, denominator).toString();

      expect(BigNumber.from(positionState)).to.be.lt(WAD);
      await expect(async () =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            liquidator.address,
            routeOnDex1,
            0,
            await getEncodedChainlinkRouteViaUsd(testTokenA),
            await getEncodedChainlinkRouteViaUsd(testTokenB),
            await getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenB, [positionManager, pair1], [positionAmount.mul(NegativeOne), positionAmount]);
    });

    it("Should liquidate risky position on dex2 if the position is risky", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = positionAmount.mul(multiplierB);

      const bnWAD = BigNumber.from(WAD.toString());
      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountOut = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);
      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const amountA = amountOut.mul(multiplierA);

      const exchangeRate = wadDiv(amountB.toString(), amountA.toString()).toString();

      const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, price0.toString());

      const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();

      const positionDebt = await positionManager.getPositionDebt(0);
      const amount0OutOracle = wadMul(amountB.toString(), priceFromOracle.toString()).toString();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
      const numerator = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracle,
      ).toString();
      const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
      const positionState = wadDiv(numerator, denominator).toString();

      expect(BigNumber.from(positionState)).to.be.lt(WAD);
      await expect(async () =>
        positionManager.connect(liquidator).closePositionByCondition({
          id: 0,
          keeper: liquidator.address,
          megaRoutes: routeOnDex2,
          conditionIndex: MaxUint256,
          ccmAdditionalParams: [],
          closeReason: CloseReason.RISKY_POSITION,
          positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
          pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        }),
      ).to.changeTokenBalances(testTokenB, [positionManager, pair2], [positionAmount.mul(NegativeOne), positionAmount]);
    });
  });
});
