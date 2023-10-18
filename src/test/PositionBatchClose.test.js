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
    constants: { MaxUint256, NegativeOne, AddressZero, Zero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  OrderType,
  NATIVE_CURRENCY,
  CloseReason,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  TRAILING_STOP_CM_TYPE,
} = require("./utils/constants");
const { SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../Constants");

const { setBadOraclePrice, fivePercent } = require("./utils/setBadOraclePrice");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { increaseBlocksBy, getImpersonateSigner } = require("./utils/hardhatUtils");
const {
  getAmountsOut,
  addLiquidity,
  getPair,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getSingleRoute,
} = require("./utils/dexOperations");
const { deployMockReserve, deployMockERC20 } = require("./utils/waffleMocks");
const {
  getTakeProfitStopLossParams,
  getTakeProfitStopLossAdditionalParams,
  getCondition,
  getTrailingStopParams,
} = require("./utils/conditionParams");
const { barCalcParams } = require("./utils/defaultBarCalcParams");
const { eventValidation, getDecodedEvents } = require("./utils/eventValidation");

process.env.TEST = true;

describe("PositionManager batch functions", function () {
  let dex,
    dex2,
    positionManager,
    traderBalanceVault,
    testTokenA,
    batchManager,
    testTokenB,
    bucket,
    debtTokenA,
    testTokenX,
    PrimexDNS,
    activityRewardDistributor,
    bucketAddress,
    firstAssetRoutes,
    routesForClose,
    interestRateStrategy,
    whiteBlackList,
    mockContract;
  let pair;
  let priceFeed, priceOracle;
  let deployer, trader, lender, liquidator;
  let snapshotIdBase;
  let mockReserve;
  let increaseBy;
  let decimalsA, decimalsB;
  let multiplierA, multiplierB;
  let tokenTransfersLibrary;
  let OpenPositionParams;
  let positionAmount, price, depositAmount, borrowedAmount, swapSize, ttaPriceInPMX, ttaPriceInETH;
  let PMXToken;
  let ErrorsLibrary, treasury;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender, liquidator } = await getNamedSigners());
    traderBalanceVault = await getContract("TraderBalanceVault");
    treasury = await getContract("Treasury");

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    PMXToken = await getContract("EPMXToken");
    activityRewardDistributor = await getContract("ActivityRewardDistributor");
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");
    whiteBlackList = await getContract("WhiteBlackList");
    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);
    batchManager = await getContract("BatchManager");
    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    const debtTokenAddress = await bucket.debtToken();
    debtTokenA = await getContractAt("DebtToken", debtTokenAddress);
    await debtTokenA.setTraderRewardDistributor(activityRewardDistributor.address);
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    ErrorsLibrary = await getContract("Errors");
    interestRateStrategy = await getContract("InterestRateStrategy");

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }
    await PMXToken.approve(activityRewardDistributor.address, parseEther("100"));
    await activityRewardDistributor.setupBucket(bucketAddress, 1, parseEther("100"), parseEther("1"));
    checkIsDexSupported(dex);
    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
    routesForClose = await getSingleRoute([testTokenB.address, testTokenA.address], dex);

    const data = await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    const pairAddress = await getPair(dex, testTokenA.address, testTokenB.address, data);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);
    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    const tokenUSD = await getContract("USD Coin");

    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_PMX", deployer.address);
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_USD", deployer.address);
    const decimalsPMX = await PMXToken.decimals();
    await priceFeedTTAPMX.setDecimals(decimalsPMX);
    await priceFeedTTAETH.setDecimals("18");

    ttaPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 tta=0.2 pmx
    ttaPriceInETH = parseUnits("0.3", 18); // 1 tta=0.3 ETH

    await priceFeedTTAPMX.setAnswer(ttaPriceInPMX);
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);
    await priceFeedTTBUSD.setAnswer(parseUnits("1", "8"));
    await priceFeedTTBUSD.setDecimals("8");

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals(decimalsA);

    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenA.address, PMXToken.address, priceFeedTTAPMX.address);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, tokenUSD.address, priceFeedTTBUSD.address);

    mockReserve = await deployMockReserve(deployer);

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    increaseBy = 2628000; // calculated for a year from average 7200 blocks per day on Ethereum

    depositAmount = parseUnits("25", decimalsA);
    borrowedAmount = parseUnits("25", decimalsA);
    swapSize = depositAmount.add(borrowedAmount);

    const lenderAmount = parseUnits("50", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender).deposit(lender.address, lenderAmount);
    await testTokenA.connect(trader).approve(positionManager.address, depositAmount);
    const deadline = new Date().getTime() + 600;

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      payFeeFromWallet: true,
      closeConditions: [],
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const price0 = wadDiv(swap.toString(), amountB.toString()).toString();
    price = BigNumber.from(price0).div(multiplierA);
    await priceFeed.setAnswer(price);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  afterEach(async function () {
    const deadline = new Date().getTime() + 600;
    firstAssetRoutes[0].shares = 1;
    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      payFeeFromWallet: true,
      closeConditions: [],
    };
  });

  describe("constructor", function () {
    let batchManagerFactory, registryAddress;
    before(async function () {
      const PositionLibrary = await getContract("PositionLibrary");
      const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
      registryAddress = (await getContract("Registry")).address;

      batchManagerFactory = await getContractFactory("BatchManager", {
        libraries: {
          PositionLibrary: PositionLibrary.address,
          PrimexPricingLibrary: PrimexPricingLibrary.address,
        },
      });
    });
    it("Should deploy dexAdapter and set the correct PM and PriceOracle", async function () {
      const batchManager = await batchManagerFactory.deploy(
        positionManager.address,
        priceOracle.address,
        whiteBlackList.address,
        registryAddress,
      );
      expect(await batchManager.positionManager()).to.be.equal(positionManager.address);
      expect(await batchManager.priceOracle()).to.be.equal(priceOracle.address);
      expect(await batchManager.whiteBlackList()).to.be.equal(whiteBlackList.address);
      expect(await batchManager.registry()).to.be.equal(registryAddress);
    });
    it("Should revert when a param '_positionManager' is not supported", async function () {
      await expect(
        batchManagerFactory.deploy(PrimexDNS.address, priceOracle.address, whiteBlackList.address, registryAddress),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when a param '_priceOracle' is not supported", async function () {
      await expect(
        batchManagerFactory.deploy(positionManager.address, PrimexDNS.address, whiteBlackList.address, registryAddress),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when a param '_whiteBlackList' is not supported", async function () {
      await expect(
        batchManagerFactory.deploy(positionManager.address, priceOracle.address, PrimexDNS.address, registryAddress),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when a param '_registry' is not supported", async function () {
      await expect(
        batchManagerFactory.deploy(positionManager.address, priceOracle.address, whiteBlackList.address, PrimexDNS.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });
  describe("pause & unpause", function () {
    let registry, snapshotId;

    before(async function () {
      registry = await getContract("Registry");
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
    it("only EMERGENCY_ADMIN can pause batchManager", async function () {
      await expect(batchManager.connect(trader).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
      await registry.grantRole(EMERGENCY_ADMIN, trader.address);
      await batchManager.connect(trader).pause();
    });

    it("only SMALL_TIMELOCK_ADMIN can unpause batchManager", async function () {
      await batchManager.pause();

      await expect(batchManager.connect(trader).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
      await registry.grantRole(SMALL_TIMELOCK_ADMIN, trader.address);
      await batchManager.connect(trader).unpause();
    });
  });
  describe("closeBatchPositions", function () {
    let snapshotId;
    let positionAmount0;
    let positionAmount1;
    let totalPositionAmount;
    const shares = [];
    let borrowedAmount, feeAmount;

    before(async function () {
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.mint(lender.address, parseUnits("100", decimalsA));
      await bucket.connect(lender).deposit(lender.address, parseUnits("50", decimalsA));
      borrowedAmount = parseUnits("30", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      const price = BigNumber.from(limitPrice).div(multiplierA);
      await priceFeed.setAnswer(price);

      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), BigNumber.from(limitPrice).mul(2))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      // to avoid the different price error
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amount0Out,
        path: [testTokenB.address, testTokenA.address],
      });

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      ({ positionAmount: positionAmount0 } = await positionManager.getPosition(0));
      ({ positionAmount: positionAmount1 } = await positionManager.getPosition(1));
      totalPositionAmount = positionAmount0.add(positionAmount1);
      shares[0] = positionAmount0.mul(WAD.toString()).div(totalPositionAmount);
      shares[1] = positionAmount1.mul(WAD.toString()).div(totalPositionAmount);
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
    it("Should revert when the array of id positions is empty", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "THERE_MUST_BE_AT_LEAST_ONE_POSITION");
    });
    it("Should revert when the passed bucket address is not correct", async function () {
      const bucketName2 = "bucket2";
      const assets = `["${testTokenB.address}"]`;
      const underlyingAsset = testTokenA.address;
      const feeBuffer = "1000200000000000000"; // 1.0002
      const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
      const quasiLinearityRate = "997000000000000000"; // 0.997
      const reserveRate = "100000000000000000"; // 0.1 - 10%
      const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
      const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

      const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
        nameBucket: bucketName2,
        positionManager: positionManager.address,
        dns: PrimexDNS.address,
        reserve: mockReserve.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: assets,
        underlyingAsset: underlyingAsset,
        feeBuffer: feeBuffer,
        withdrawalFeeRate: withdrawalFeeRate,
        quasiLinearityRate: quasiLinearityRate,
        reserveRate: reserveRate,
        liquidityMiningRewardDistributor: AddressZero,
        liquidityMiningAmount: "0",
        liquidityMiningDeadline: "0",
        stabilizationDuration: "0",
        interestRateStrategy: interestRateStrategy.address,
        maxAmountPerUser: "0",
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: JSON.stringify(barCalcParams),
        maxTotalDeposit: MaxUint256.toString(),
      });
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            newBucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_BUCKET_IS_INCORRECT");
    });
    it("Should revert when msg.sender is on the black list", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        batchManager
          .connect(mockContract)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });

    it("Should revert when contract is paused", async function () {
      await batchManager.pause();
      await expect(
        batchManager.closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        ),
      ).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert when the passed position asset doesn't match the asset of the positions", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenX.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when the passed sold asset doesn't match bucket's borrowed asset", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenX.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when the passed sold asset doesn't match the sold asset of the spot positions", async function () {
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [2, 3],
            routesForClose,
            testTokenB.address,
            testTokenX.address,
            AddressZero,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SOLD_ASSET_IS_INCORRECT");
    });
    it("Should revert when ids and conditionIndexes arrays have different length for TP/SL", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_STOP_LOSS,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "PARAMS_LENGTH_MISMATCH");
    });
    it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await setBadOraclePrice(priceFeed, fivePercent, true, dexExchangeRate);
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });
    it("Should revert when the passed CloseReason is not supported", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.CLOSE_BY_TRADER,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BATCH_CANNOT_BE_CLOSED_FOR_THIS_REASON");
    });
    it("Shouldn't liquidate position until it is not risky", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NOTHING_TO_CLOSE");
    });
    it("Should liquidate position if it's not risky but positionAsset is removed from allowedAsset of this bucket", async function () {
      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      // to make the health > WAD
      await priceFeed.setAnswer(dexExchangeRate.mul("2"));
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NOTHING_TO_CLOSE");

      await priceFeed.setAnswer(dexExchangeRate);

      await bucket.removeAsset(testTokenB.address);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
    });

    it("Should liquidate positions by BUCKET_DELISTED reason and return the rest of deposit to trader", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10000", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      await PrimexDNS.deprecateBucket("bucket1");
      const delistingDeadline = (await PrimexDNS.buckets("bucket1")).delistingDeadline;
      const txBlockTimestamp = delistingDeadline.add(1);

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance0 = (await positionManager.getPosition(0)).scaledDebtAmount;
      const scaledDebtBalance1 = (await positionManager.getPosition(1)).scaledDebtAmount;

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);

      const positionDebt0 = rayMul(
        scaledDebtBalance0.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const positionDebt1 = rayMul(
        scaledDebtBalance1.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const shareOfBorrowedAmountOut0 = positionAmount0.mul(amount0Out).div(totalPositionAmount);
      const shareOfBorrowedAmountOut1 = positionAmount1.mul(amount0Out).div(totalPositionAmount);

      const returnedToTrader0 = shareOfBorrowedAmountOut0.sub(positionDebt0);
      const returnedToTrader1 = shareOfBorrowedAmountOut1.sub(positionDebt1);

      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      await expect(() =>
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BUCKET_DELISTED,
          ),
      ).to.changeTokenBalances(
        testTokenA,
        [bucket, traderBalanceVault],
        [amount0Out.sub(returnedToTrader0.add(returnedToTrader1)), returnedToTrader0.add(returnedToTrader1)],
      );
      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(returnedToTrader0.add(returnedToTrader1));
    });

    it("Should revert liquidate positions by BUCKET_DELISTED reason if bucket isn't delisted", async function () {
      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BUCKET_DELISTED,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
    });
    it("Should liquidate risky positions and transfer testTokenB from 'PositionManager' to dex", async function () {
      const bnWAD = BigNumber.from(WAD.toString());

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amountB1 = positionAmount1.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
      const securityBuffer = await positionManager.securityBuffer();

      const positionDebt0 = await positionManager.getPositionDebt(0);
      const positionDebt1 = await positionManager.getPositionDebt(1);
      let amount0OutOracle = wadMul(amountB0.toString(), dexExchangeRate.mul(multiplierA).toString()).toString();
      amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();
      let amount1OutOracle = wadMul(amountB1.toString(), dexExchangeRate.mul(multiplierA).toString()).toString();
      amount1OutOracle = BigNumber.from(amount1OutOracle).div(multiplierA).toString();

      const numerator0 = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracle,
      ).toString();
      const numerator1 = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount1OutOracle,
      ).toString();
      const denominator0 = wadMul(feeBuffer.toString(), positionDebt0.toString()).toString();
      const denominator2 = wadMul(feeBuffer.toString(), positionDebt1.toString()).toString();
      const positionState0 = wadDiv(numerator0, denominator0).toString();
      const positionState1 = wadDiv(numerator1, denominator2).toString();

      expect(await positionManager.healthPosition(0)).to.equal(positionState0);
      expect(await positionManager.healthPosition(1)).to.equal(positionState1);
      expect(positionState0).to.be.lt(bnWAD);
      expect(positionState1).to.be.lt(bnWAD);

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountA.toString(), totalAmountB.toString()).toString();
      await priceFeed.setAnswer(BigNumber.from(totalPrice).div(multiplierA));

      await expect(() =>
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.changeTokenBalances(testTokenB, [positionManager, pair], [totalPositionAmount.mul(NegativeOne), totalPositionAmount]);
    });

    it("Should skip id if position does not exist", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1, 100],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
      const txReceipt = await tx.wait();
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should liquidate 2 out of 3 positions when the last one is not risky", async function () {
      // open the third position with a small debt so that the position could not be liquidated
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      let amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      // make 2 out of 3 positions risky
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      amountOut = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amountOut.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      expect(await positionManager.isPositionRisky(0)).to.be.equal(true);
      expect(await positionManager.isPositionRisky(1)).to.be.equal(true);
      expect(await positionManager.isPositionRisky(2)).to.be.equal(false);

      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1, 2],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
      const txReceipt = await tx.wait();
      // closeTo because of the index
      expect(await debtTokenA.balanceOf(trader.address)).to.be.closeTo(borrowedOfNonRiskyPosition, parseUnits("0.001", decimalsA));
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should liquidate 3 out of 4 positions when the second to last one is not risky", async function () {
      // open the third position with a small debt so that the position could not be liquidated
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);

      let swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      let swap = swapSize.mul(multiplierA);
      let amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      let amountB = amountOut.mul(multiplierB);
      let limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      let price = BigNumber.from(limitPrice).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      OpenPositionParams.marginParams.borrowedAmount = parseUnits("1", decimalsA);
      OpenPositionParams.depositAmount = parseUnits("10", decimalsA);
      swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);

      swap = swapSize.mul(multiplierA);
      amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amountOut.mul(multiplierB);
      limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(limitPrice).div(multiplierA);
      await priceFeed.setAnswer(price);

      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      // make 3 out of 4 positions risky
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("2", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      expect(await positionManager.isPositionRisky(0)).to.be.equal(true);
      expect(await positionManager.isPositionRisky(1)).to.be.equal(true);
      expect(await positionManager.isPositionRisky(2)).to.be.equal(false);
      expect(await positionManager.isPositionRisky(3)).to.be.equal(true);

      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1, 2, 3],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
      const txReceipt = await tx.wait();
      // closeTo because of the index
      expect(await debtTokenA.balanceOf(trader.address)).to.be.closeTo(borrowedOfNonRiskyPosition, parseUnits("0.001", decimalsA));
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));

      const eventClosePosition0 = events[0].args;
      const eventClosePosition1 = events[1].args;
      const eventClosePosition2 = events[2].args;

      expect(eventClosePosition0.positionId).to.equal(0);
      expect(eventClosePosition1.positionId).to.equal(1);
      expect(eventClosePosition2.positionId).to.equal(3);
      expect(events.length).to.be.equal(3);
    });

    it("Should revert when closing a batch of several identical ids", async function () {
      // open the third position with a small debt so that the position could not be liquidated
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);

      let swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      let swap = swapSize.mul(multiplierA);
      let amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      let amountB = amountOut.mul(multiplierB);
      let limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      let price = BigNumber.from(limitPrice).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      OpenPositionParams.marginParams.borrowedAmount = parseUnits("1", decimalsA);
      OpenPositionParams.depositAmount = parseUnits("10", decimalsA);
      swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);

      swap = swapSize.mul(multiplierA);
      amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amountOut.mul(multiplierB);
      limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(limitPrice).div(multiplierA);
      await priceFeed.setAnswer(price);

      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      // make 3 out of 4 positions risky
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("2", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      expect(await positionManager.isPositionRisky(0)).to.be.equal(true);
      expect(await positionManager.isPositionRisky(1)).to.be.equal(true);
      expect(await positionManager.isPositionRisky(2)).to.be.equal(false);
      expect(await positionManager.isPositionRisky(3)).to.be.equal(true);

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [3, 3, 3],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_DOES_NOT_EXIST");
    });

    it("Should liquidate risky positions and delete from traderPositions list", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should calculate permanentLossScaled after bucket's indexes update", async function () {
      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      const borrowedAssetAmountOut = amount0Out;

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance0 = (await positionManager.getPosition(0)).scaledDebtAmount;
      const scaledDebtBalance1 = (await positionManager.getPosition(1)).scaledDebtAmount;

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt0 = rayMul(
        scaledDebtBalance0.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const positionDebt1 = rayMul(
        scaledDebtBalance1.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const permanentLoss = BigNumber.from(positionDebt0).add(BigNumber.from(positionDebt1)).sub(borrowedAssetAmountOut); // goes to batchDecrease...

      const liquidityIndexBeforeCloseBatch = await bucket.liquidityIndex();
      const permanentLossScaledUsingLiquidityIndexBefore = rayDiv(
        permanentLoss.toString(),
        liquidityIndexBeforeCloseBatch.toString(),
      ).toString();

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );

      const liquidityIndexAfterCloseBatch = await bucket.liquidityIndex();
      const permanentLossScaledUsingLiquidityIndexAfter = rayDiv(
        permanentLoss.toString(),
        liquidityIndexAfterCloseBatch.toString(),
      ).toString();
      expect(permanentLossScaledUsingLiquidityIndexBefore).to.not.equal(permanentLossScaledUsingLiquidityIndexAfter);

      const permanentLossScaledFromBucket = await bucket.permanentLossScaled();
      expect(permanentLossScaledFromBucket).to.be.equal(permanentLossScaledUsingLiquidityIndexAfter);
    });

    it("Should liquidate risky position and fully repay trader's debt after n blocks", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      await increaseBlocksBy(increaseBy);
      expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(Zero);

      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);

      await priceFeed.setAnswer(dexExchangeRate);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should liquidate risky positions and fully delete trader's deposit from 'TraderBalanceVault'", async function () {
      let amountToSwap;
      if (dex === "curve") {
        amountToSwap = parseUnits("20", decimalsB);
      } else {
        amountToSwap = parseUnits("1", decimalsB);
      }

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amountToSwap.toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);

      await priceFeed.setAnswer(dexExchangeRate);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(availableBefore).to.equal(availableAfter).to.equal(0);
    });

    it("Should liquidate risky position and burn the trader's debt tokens", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );

      const { availableBalance: balanceOfTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(balanceOfTrader).to.equal(0);

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });
    it("Should liquidate risky position 1 block past and transfer testTokenA to 'Bucket' and the rest of deposit transfer to Treasury", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountA.toString(), totalAmountB.toString()).toString();
      await priceFeed.setAnswer(BigNumber.from(totalPrice).div(multiplierA));

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance0 = (await positionManager.getPosition(0)).scaledDebtAmount;
      const scaledDebtBalance1 = (await positionManager.getPosition(1)).scaledDebtAmount;

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt0 = rayMul(
        scaledDebtBalance0.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const positionDebt1 = rayMul(
        scaledDebtBalance1.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const amountToTreasure = totalAmountOut.sub(positionDebt1).sub(positionDebt0);

      await expect(() =>
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.changeTokenBalances(testTokenA, [bucket, treasury], [BigNumber.from(positionDebt1).add(positionDebt0), amountToTreasure]);
    });
    it("Should close positions by SL and correct updating of ActivityRewardDistributor when closing all user positions", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("50", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountA.toString(), totalAmountB.toString()).toString();
      await priceFeed.setAnswer(BigNumber.from(totalPrice).div(multiplierA));

      // check that all the values after mint are the same
      const { oldBalance: oldBalanceBefore } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupplyBefore = await debtTokenA.scaledTotalSupply();
      const balanceOfBefore = await debtTokenA.scaledBalanceOf(trader.address);

      expect(oldBalanceBefore).to.be.equal(totalSupplyBefore).to.be.equal(balanceOfBefore);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [0, 0],
          CloseReason.BATCH_STOP_LOSS,
        );

      const { oldBalance } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupply = await debtTokenA.scaledTotalSupply();
      const balanceOfBeforeAfter = await debtTokenA.scaledBalanceOf(trader.address);
      expect(oldBalance).to.be.equal(totalSupply).to.be.equal(balanceOfBeforeAfter).to.be.equal(Zero);
    });
    it("Should close positions by SL and correct updating of ActivityRewardDistributor when closing 2 out of 3 user positions", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("50", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      // open third position
      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: parseEther("1"),
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountA.toString(), totalAmountB.toString()).toString();
      await priceFeed.setAnswer(BigNumber.from(totalPrice).div(multiplierA));

      // check that all the values after mint are the same
      const { oldBalance: oldBalanceBefore } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupplyBefore = await debtTokenA.scaledTotalSupply();
      const balanceOfBefore = await debtTokenA.scaledBalanceOf(trader.address);

      expect(oldBalanceBefore).to.be.equal(totalSupplyBefore).to.be.equal(balanceOfBefore);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [0, 0],
          CloseReason.BATCH_STOP_LOSS,
        );

      const { oldBalance } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupply = await debtTokenA.scaledTotalSupply();
      const balanceOfBeforeAfter = await debtTokenA.scaledBalanceOf(trader.address);
      expect(oldBalance).to.be.equal(totalSupply).to.be.equal(balanceOfBeforeAfter);
    });
    it("Should close positions by SL and return the rest of deposit to trader", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("50", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountA.toString(), totalAmountB.toString()).toString();
      await priceFeed.setAnswer(BigNumber.from(totalPrice).div(multiplierA));

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance0 = (await positionManager.getPosition(0)).scaledDebtAmount;
      const scaledDebtBalance1 = (await positionManager.getPosition(1)).scaledDebtAmount;

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt0 = rayMul(
        scaledDebtBalance0.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const positionDebt1 = rayMul(
        scaledDebtBalance1.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const shareOfBorrowedAmountOut0 = positionAmount0.mul(totalAmountOut).div(totalPositionAmount);
      const shareOfBorrowedAmountOut1 = positionAmount1.mul(totalAmountOut).div(totalPositionAmount);

      const returnedToTrader0 = shareOfBorrowedAmountOut0.sub(positionDebt0);
      const returnedToTrader1 = shareOfBorrowedAmountOut1.sub(positionDebt1);

      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [0, 0],
          CloseReason.BATCH_STOP_LOSS,
        );

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(returnedToTrader0.add(returnedToTrader1));
    });

    it("Should close 2 out of 3 positions by SL when the last one can't be closed", async function () {
      // open the third position with low stop loss so that the position could not be closed
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);
      OpenPositionParams.closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, 1))];
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      const additionalParams = getTakeProfitStopLossAdditionalParams(routesForClose);
      expect(await positionManager.callStatic.canBeClosed(0, 0, additionalParams)).to.be.equal(true);
      expect(await positionManager.callStatic.canBeClosed(1, 0, additionalParams)).to.be.equal(true);
      expect(await positionManager.callStatic.canBeClosed(2, 0, additionalParams)).to.be.equal(false);

      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1, 2],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [0, 0, 0],
          CloseReason.BATCH_STOP_LOSS,
        );
      const txReceipt = await tx.wait();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should close 2 positions by SL and ensuring the correct closing condition is applied even when some of the positions in the array do not exist", async function () {
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));

      const additionalParams = getTakeProfitStopLossAdditionalParams(routesForClose);
      expect(await positionManager.callStatic.canBeClosed(0, 0, additionalParams)).to.be.equal(true);
      expect(await positionManager.callStatic.canBeClosed(1, 0, additionalParams)).to.be.equal(true);

      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 15, 16, 17, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [0, 1, 2, 3, 0],
          CloseReason.BATCH_STOP_LOSS,
        );
      const txReceipt = await tx.wait();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should close 2 out of 3 positions by liqudation when the last has no debt", async function () {
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));

      OpenPositionParams.marginParams.borrowedAmount = parseUnits("0.2", decimalsA);
      OpenPositionParams.depositAmount = parseUnits("2", decimalsA);
      const swapSize = parseUnits("2.5", decimalsA);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      const positionsId = await positionManager.positionsId();
      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: parseEther("1"),
      });
      // paying off the debt
      await positionManager.connect(trader).increaseDeposit(positionsId, parseUnits("1", decimalsA), testTokenA.address, true, [], 0);
      const scaledDebtAmount = (await positionManager.getPosition(positionsId)).scaledDebtAmount;
      expect(scaledDebtAmount).to.be.equal(0);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("2.5", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const swapSizeB = amountOut.mul(multiplierB);
      const amountOutA = await getAmountsOut(dex, swapSizeB, [testTokenB.address, testTokenA.address]);
      const amountA = amountOutA.mul(multiplierA);
      price = wadDiv(swapSizeB.toString(), amountA.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1, 2],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BATCH_LIQUIDATION,
        );
      const txReceipt = await tx.wait();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should be able to close spot positions by TP/SL", async function () {
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
      const swapSize = OpenPositionParams.depositAmount.mul(2);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      const exchRate = wadDiv(swap.toString(), amountB.toString()).toString();
      let price = BigNumber.from(exchRate).div(multiplierA);
      await priceFeed.setAnswer(price);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, BigNumber.from(exchRate).mul(10000))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      expect(await positionManager.callStatic.canBeClosed(2, 0, [])).to.be.equal(true);

      const { positionAmount: positionAmount2 } = await positionManager.getPosition(2);
      const { positionAmount: positionAmount3 } = await positionManager.getPosition(3);
      const totalPositionAmount23 = positionAmount2.add(positionAmount3);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount23, [testTokenB.address, testTokenA.address]);
      const shareOfBorrowedAmountOut2 = positionAmount2.mul(totalAmountOut).div(totalPositionAmount23);
      const shareOfBorrowedAmountOut3 = positionAmount3.mul(totalAmountOut).div(totalPositionAmount23);

      const totalTokenA = shareOfBorrowedAmountOut2.add(shareOfBorrowedAmountOut3);

      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() =>
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [2, 3],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            AddressZero,
            [0, 0],
            CloseReason.BATCH_STOP_LOSS,
          ),
      ).to.changeTokenBalance(testTokenA, traderBalanceVault, totalAmountOut);

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(totalTokenA);
    });

    it("Should revert spot batch close if it doesn't pass oracle check", async function () {
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
      const swapSize = OpenPositionParams.depositAmount.mul(2);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      const priceRate = wadDiv(swap.toString(), amountB.toString()).toString();
      const price = BigNumber.from(priceRate).div(multiplierA);
      await priceFeed.setAnswer(price);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, BigNumber.from(priceRate).mul(10000))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });
      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      await setBadOraclePrice(priceFeed, fivePercent, true, price);

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [2, 3],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            AddressZero,
            [0, 0],
            CloseReason.BATCH_STOP_LOSS,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });

    it("Should revert if at least one position is spot and bucket is not AddressZero", async function () {
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
      const swapSize = OpenPositionParams.depositAmount.mul(2);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: parseEther("1"),
      });

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1, 2],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_BUCKET_IS_INCORRECT");
    });

    it("Should revert batch close if at least one can't be closed by TP", async function () {
      // open the third position with high take profit so that the position could not be closed
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      OpenPositionParams.marginParams.borrowedAmount = parseUnits("0.1", decimalsA);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(MaxUint256.div(WAD), 1)),
      ];

      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      const additionalParams = getTakeProfitStopLossAdditionalParams(routesForClose);
      expect(await positionManager.callStatic.canBeClosed(0, 0, additionalParams)).to.be.equal(true);
      expect(await positionManager.callStatic.canBeClosed(1, 0, additionalParams)).to.be.equal(true);
      expect(await positionManager.callStatic.canBeClosed(2, 0, additionalParams)).to.be.equal(false);

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1, 2],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0, 0],
            CloseReason.BATCH_TAKE_PROFIT,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
    });

    it("Should revert close by SL if first position has wrong close manager", async function () {
      // open the third position with low stop loss so that the position could not be closed
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);
      OpenPositionParams.closeConditions = [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(parseEther("1"), 1))];
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [2, 1, 0],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0, 0],
            CloseReason.BATCH_STOP_LOSS,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CLOSE_CONDITION_IS_NOT_CORRECT");
    });

    it("Should revert close by TP if first position has wrong close manager", async function () {
      // open the third position with high take profit so that the position could not be closed
      await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, parseEther("0.5"));
      OpenPositionParams.marginParams.borrowedAmount = parseUnits("0.1", decimalsA);
      OpenPositionParams.closeConditions = [getCondition(TRAILING_STOP_CM_TYPE, getTrailingStopParams(parseEther("1"), 1))];

      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const feeAmountCalculateWithETHRate = wadMul(
        swapSize.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmount = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), ttaPriceInETH.toString()).toString();

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(swap.toString(), amountB.toString()).toString();
      price = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(OpenPositionParams, {
        value: feeAmount,
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountA.toString(), amountB0.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(multiplierA);
      await priceFeed.setAnswer(dexExchangeRate);

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [2, 1, 0],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0, 0],
            CloseReason.BATCH_TAKE_PROFIT,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CLOSE_CONDITION_IS_NOT_CORRECT");
    });

    describe("Batch close events", function () {
      let expectedClosePosition0Event, expectedClosePosition1Event;
      before(async function () {
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseUnits("1", decimalsB).toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        for (let i = 0; i < 3; i++) {
          await network.provider.send("evm_mine");
        }
        const totalAmountB = totalPositionAmount.mul(multiplierB);
        const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);

        const amountOut0 = positionAmount0.mul(totalAmountOut).div(totalPositionAmount);
        const amountOut1 = positionAmount1.mul(totalAmountOut).div(totalPositionAmount);

        const totalAmountA = totalAmountOut.mul(multiplierA);
        const totalPrice = wadDiv(totalAmountA.toString(), totalAmountB.toString()).toString();
        await priceFeed.setAnswer(BigNumber.from(totalPrice).div(multiplierA));
        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance0 = (await positionManager.getPosition(0)).scaledDebtAmount;
        const scaledDebtBalance1 = (await positionManager.getPosition(1)).scaledDebtAmount;

        const depositAmount0 = (await positionManager.getPosition(0)).depositAmountInSoldAsset;
        const depositAmount1 = (await positionManager.getPosition(1)).depositAmountInSoldAsset;

        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt0 = rayMul(
          scaledDebtBalance0.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        ).toString();

        const positionDebt1 = rayMul(
          scaledDebtBalance1.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        ).toString();

        const shareOfBorrowedAmountOut0 = totalAmountOut.mul(shares[0]).div(WAD.toString());
        const shareOfBorrowedAmountOut1 = totalAmountOut.mul(shares[1]).div(WAD.toString());

        let profit0, profit1;
        if (shareOfBorrowedAmountOut0.gt(positionDebt0)) {
          profit0 = shareOfBorrowedAmountOut0.sub(positionDebt0).sub(depositAmount0);
        } else {
          profit0 = BigNumber.from(Zero).sub(depositAmount0);
        }
        if (shareOfBorrowedAmountOut1.gt(positionDebt1)) {
          profit1 = shareOfBorrowedAmountOut1.sub(positionDebt1).sub(depositAmount1);
        } else {
          profit1 = BigNumber.from(Zero).sub(depositAmount1);
        }
        expectedClosePosition0Event = {
          positionId: 0,
          trader: trader.address,
          closedBy: liquidator.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmount0,
          profit: profit0,
          positionDebt: positionDebt0,
          amountOut: amountOut0,
          reason: undefined,
        };
        expectedClosePosition1Event = {
          positionId: 1,
          trader: trader.address,
          closedBy: liquidator.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmount1,
          profit: profit1,
          positionDebt: positionDebt1,
          amountOut: amountOut1,
          reason: undefined,
        };
      });
      it("Should liquidate risky positions and throw event", async function () {
        const tx = await batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
          );
        expectedClosePosition0Event.reason = CloseReason.BATCH_LIQUIDATION;
        expectedClosePosition1Event.reason = CloseReason.BATCH_LIQUIDATION;

        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition1Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
      });

      it("Should close positions by SL and throw event", async function () {
        const tx = await batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0],
            CloseReason.BATCH_STOP_LOSS,
          );

        expectedClosePosition0Event.reason = CloseReason.BATCH_STOP_LOSS;
        expectedClosePosition1Event.reason = CloseReason.BATCH_STOP_LOSS;

        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition1Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
      });

      it("Should close positions by TP and throw event", async function () {
        const tx = await batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0],
            CloseReason.BATCH_TAKE_PROFIT,
          );

        expectedClosePosition0Event.reason = CloseReason.BATCH_TAKE_PROFIT;
        expectedClosePosition1Event.reason = CloseReason.BATCH_TAKE_PROFIT;

        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition1Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
      });
    });
  });
});
