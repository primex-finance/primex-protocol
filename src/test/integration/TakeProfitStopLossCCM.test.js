// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
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

const { getTakeProfitStopLossParams, getCondition } = require("../utils/conditionParams");

const { getAmountsOut, addLiquidity, getSingleMegaRoute } = require("../utils/dexOperations");

const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");

const {
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  MAX_TOKEN_DECIMALITY,
  NATIVE_CURRENCY,
  USD_DECIMALS,
  USD_MULTIPLIER,
} = require("../utils/constants");

const { wadDiv } = require("../utils/math");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
  reversePrice,
} = require("../utils/oracleUtils");

process.env.TEST = true;

describe("TakeProfitStopLossCCM_integration", function () {
  let snapshotId;
  let trader, lender;
  let primexDNS,
    priceOracle,
    registry,
    testTokenA,
    testTokenB,
    bucket,
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
  let assetRoutes, dex, bucketAddress;

  before(async function () {
    await fixture(["Test"]);
    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }

    ({ trader, lender } = await getNamedSigners());
    takeProfitStopLossCCM = await getContract("TakeProfitStopLossCCM");
    primexDNS = await getContract("PrimexDNS");
    priceOracle = await getContract("PriceOracle");
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

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    assetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);

    priceOracle = await getContract("PriceOracle");

    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

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
    let TakeProfitStopLossCCMFactory;

    before(async function () {
      TakeProfitStopLossCCMFactory = await getContractFactory("TakeProfitStopLossCCM");
    });

    it("Should initialize with correct values", async function () {
      expect(await takeProfitStopLossCCM.primexDNS()).to.equal(primexDNS.address);
      expect(await takeProfitStopLossCCM.priceOracle()).to.equal(priceOracle.address);
    });

    it("Should revert when initialized with wrong primexDNS address", async function () {
      const wrongAddress = registry.address;
      const TakeProfitStopLossCCM = await TakeProfitStopLossCCMFactory.deploy(registry.address);
      await expect(TakeProfitStopLossCCM.initialize(wrongAddress, priceOracle.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert when initialized with wrong priceOracle address", async function () {
      const wrongAddress = registry.address;
      const TakeProfitStopLossCCM = await TakeProfitStopLossCCMFactory.deploy(registry.address);
      await expect(TakeProfitStopLossCCM.initialize(primexDNS.address, wrongAddress)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("canBeClosed", function () {
    let borrowedAmount, lenderAmount, depositAmount, amountOutMin, deadline, takeDepositFromWallet, snapshotId, price;

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
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
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

    it("isStopLossReached should return 'false' when stopLossPrice < oracle price", async function () {
      const stopLossPrice = reversePrice(price.toString()).mul(USD_MULTIPLIER).sub("1").toString();

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      expect(await primexLens.callStatic.isStopLossReached(pmAddress, 0, getEncodedChainlinkRouteViaUsd(testTokenA))).to.be.equal(false);
    });
    it("isStopLossReached should return 'true' when oracle price <= stopLossPrice", async function () {
      const stopLossPrice = reversePrice(price.toString()).mul(USD_MULTIPLIER).toString();

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      // when stopLossPrice == exchangeRate
      expect(await primexLens.callStatic.isStopLossReached(pmAddress, 0, getEncodedChainlinkRouteViaUsd(testTokenA))).to.be.equal(true);
      // when stopLossPrice > exchangeRate;
      await setOraclePrice(testTokenA, testTokenB, price.add("2"));
      expect(await primexLens.callStatic.isStopLossReached(pmAddress, 0, getEncodedChainlinkRouteViaUsd(testTokenA))).to.be.equal(true);
    });
  });
});
