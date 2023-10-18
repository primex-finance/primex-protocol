// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    // getContractFactory,
    getSigners,
    getNamedSigners,
    utils: { parseEther, parseUnits, defaultAbiCoder },
    constants: { MaxUint256, One, Zero, AddressZero, NegativeOne },
    BigNumber,
    getContractFactory,
  },
  deployments: { fixture },
} = require("hardhat");
const { BigNumber: BN } = require("bignumber.js");
const { getAmountsOut, addLiquidity, checkIsDexSupported, swapExactTokensForTokens, getSingleRoute } = require("./utils/dexOperations");
const { parseArguments } = require("./utils/eventValidation");
const { getAdminSigners, getImpersonateSigner } = require("./utils/hardhatUtils");
const { addressFromEvent } = require("./utils/addressFromEvent");

const {
  rayMul,
  rayDiv,
  calculateCompoundInterest,
  wadMul,
  wadDiv,
  calculateLinearInterest,
  calculateMaxAssetLeverage,
} = require("./utils/math");
const { MAX_TOKEN_DECIMALITY, WAD, BAR_CALC_PARAMS_DECODE, RAY, USD, OrderType, NATIVE_CURRENCY } = require("./utils/constants");
const { getPoolAddressesProvider } = require("@aave/deploy-v3");
const {
  deployMockPToken,
  deployMockDebtToken,
  deployMockPositionManager,
  deployMockPriceOracle,
  deployMockPrimexDNS,
  deployMockReserve,
  deployMockAccessControl,
  deployMockERC20,
  deployMockInterestRateStrategy,
  deployMockWhiteBlackList,
  deployMockPtokensFactory,
  deployMockDebtTokensFactory,
} = require("./utils/waffleMocks");
const { barCalcParams: defaultBarCalcParams } = require("./utils/defaultBarCalcParams");

const feeBuffer = "1000200000000000000"; // 1.0002
const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
const reserveRate = "100000000000000000"; // 0.1 - 10%
const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
const estimatedLar = "70000000000000000000000000"; // 0.07 in ray
let maintenanceBuffer, securityBuffer, oracleTolerableLimitAB, oracleTolerableLimitBA;

process.env.TEST = true;

describe("Bucket", function () {
  let priceFeed,
    pTestTokenA,
    reserve,
    testTokenA,
    decimalsA,
    bucket,
    pairPriceDrop,
    positionManager,
    priceOracle,
    ErrorsLibrary,
    testTokenB,
    decimalsB,
    traderBalanceVault,
    PrimexDNS,
    BucketsFactory,
    dex;
  let testTokenX, testTokenY, testTokenZ;
  let deployer, lender, caller, trader;
  let depositAmount;
  let mockRegistry,
    mockPToken,
    mockPrimexDns,
    mockDebtToken,
    mockPositionManager,
    mockInterestRateStrategy,
    mockWhiteBlackList,
    mockPtokensFactory,
    mockDebtTokensFactory;
  let LiquidityMiningRewardDistributor;
  let protocolRate, PriceInETH;
  let BigTimelockAdmin, MediumTimelockAdmin, SmallTimelockAdmin;
  let barCalcParams, interestRateStrategy;
  let multiplierA;
  before(async function () {
    await fixture(["Test"]);
    await run("deploy:Aave");

    ({ deployer, lender, caller, trader } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    traderBalanceVault = await getContract("TraderBalanceVault");
    BucketsFactory = await getContract("BucketsFactory");
    PrimexDNS = await getContract("PrimexDNS");
    ErrorsLibrary = await getContract("Errors");
    LiquidityMiningRewardDistributor = await getContract("LiquidityMiningRewardDistributor");
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");
    interestRateStrategy = await getContract("InterestRateStrategy");

    barCalcParams = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(defaultBarCalcParams)]);
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    ({ BigTimelockAdmin, MediumTimelockAdmin, SmallTimelockAdmin } = await getAdminSigners());

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    const pTestTokenAddress = await bucket.pToken();
    const reserveAddress = await bucket.reserve();

    pTestTokenA = await getContractAt("PToken", pTestTokenAddress);
    reserve = await getContractAt("Reserve", reserveAddress);

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([lender.address, deployer.address]),
      initialBalances: JSON.stringify([parseEther("100").toString(), parseEther("100").toString()]),
    });
    await run("deploy:ERC20Mock", {
      name: "TestTokenY",
      symbol: "TTY",
      decimals: "18",
      initialAccounts: JSON.stringify([lender.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    await run("deploy:ERC20Mock", {
      name: "TestTokenZ",
      symbol: "TTZ",
      decimals: "18",
      initialAccounts: JSON.stringify([lender.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    testTokenY = await getContract("TestTokenY");
    testTokenZ = await getContract("TestTokenZ");

    await testTokenA.connect(lender).approve(pTestTokenA.address, MaxUint256);

    dex = process.env.DEX || "uniswap";
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB, tokenC: testTokenX });

    depositAmount = parseUnits("50", decimalsA);
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
    await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);
    // a stub so that the tests do not fail.
    // this is acceptable because in these tests the bucket is checked
    // and it is important in it that the position has opened and not the conditions for its opening
    await priceFeed.setAnswer(1);
    await priceFeed.setDecimals(decimalsB);

    protocolRate = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY);

    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(PriceInETH);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
  });
  function calculateFee(depositAmount, borrowedAmount) {
    const feeAmountCalculateWithETHRate = wadMul(
      borrowedAmount.add(depositAmount).mul(multiplierA).toString(),
      protocolRate.toString(),
    ).toString();
    return wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();
  }
  describe("Initialization", function () {
    let bucketName;
    let mockReserve;
    let assets;
    let feeBuffer;
    let reserveRate;
    let bucketInitParams;
    let testTokenBAssets;
    let snapshotId;
    let bucketsFactory, bucketsFactoryContractFactory, bucketImplementation;
    let mockErc20;

    before(async function () {
      bucketName = "Bucket";
      testTokenBAssets = await getContract("TestTokenB");
      assets = [testTokenBAssets.address];
      feeBuffer = parseEther("1.0002");
      reserveRate = 0;
      mockErc20 = await deployMockERC20(deployer);
      mockReserve = await deployMockReserve(deployer);
      mockPToken = await deployMockPToken(deployer);
      mockDebtToken = await deployMockDebtToken(deployer);
      mockPositionManager = await deployMockPositionManager(deployer);
      mockPrimexDns = await deployMockPrimexDNS(deployer);
      mockRegistry = await deployMockAccessControl(deployer);
      mockInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
      mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
      mockPtokensFactory = await deployMockPtokensFactory(deployer);
      mockDebtTokensFactory = await deployMockDebtTokensFactory(deployer);
      bucketImplementation = await getContract("Bucket");
      bucketsFactoryContractFactory = await getContractFactory("BucketsFactory");
    });

    beforeEach(async function () {
      mockPToken = await deployMockPToken(deployer);
      mockDebtToken = await deployMockDebtToken(deployer);

      await mockPtokensFactory.mock.createPToken.returns(mockPToken.address);
      await mockDebtTokensFactory.mock.createDebtToken.returns(mockDebtToken.address);

      bucketsFactory = await bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      );
      await bucketsFactory.deployed();

      bucketInitParams = {
        nameBucket: bucketName,
        positionManager: mockPositionManager.address,
        priceOracle: priceOracle.address,
        dns: mockPrimexDns.address,
        reserve: mockReserve.address,
        whiteBlackList: mockWhiteBlackList.address,
        assets: assets,
        underlyingAsset: testTokenA.address,
        feeBuffer: feeBuffer.toString(),
        withdrawalFeeRate: withdrawalFeeRate.toString(),
        reserveRate: reserveRate.toString(),
        liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
        liquidityMiningAmount: 1,
        liquidityMiningDeadline: MaxUint256.div(2),
        stabilizationDuration: 1,
        interestRateStrategy: interestRateStrategy.address,
        maxAmountPerUser: MaxUint256,
        isReinvestToAaveEnabled: false,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: barCalcParams,
        maxTotalDeposit: MaxUint256,
      };

      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should deploy bucket with liquidity mining is off and check initial params", async function () {
      bucketInitParams.liquidityMiningAmount = "0";
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);

      const bucket = await getContractAt("Bucket", bucketAddress);

      const LiquidityMiningParams = {
        liquidityMiningRewardDistributor: AddressZero,
        isBucketLaunched: true,
        accumulatingAmount: 0,
        deadlineTimestamp: 0,
        stabilizationDuration: 0,
        stabilizationEndTimestamp: 0,
        maxAmountPerUser: 0,
        maxDuration: 0,
        maxStabilizationEndTimestamp: 0,
      };

      parseArguments(LiquidityMiningParams, await bucket.getLiquidityMiningParams());
    });

    it("Should deploy bucket with liquidity mining is on and check initial params", async function () {
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);
      const bucket = await getContractAt("Bucket", bucketAddress);

      const blockNumber = txReceipt.blockNumber;
      const timestamp = (await provider.getBlock(blockNumber)).timestamp;
      const maxStabilizationEndTimestamp = bucketInitParams.liquidityMiningDeadline.add(bucketInitParams.stabilizationDuration);

      const LiquidityMiningParams = {
        liquidityMiningRewardDistributor: bucketInitParams.liquidityMiningRewardDistributor,
        isBucketLaunched: false,
        accumulatingAmount: bucketInitParams.liquidityMiningAmount,
        deadlineTimestamp: bucketInitParams.liquidityMiningDeadline,
        stabilizationDuration: bucketInitParams.stabilizationDuration,
        stabilizationEndTimestamp: 0,
        maxAmountPerUser: MaxUint256,
        maxDuration: maxStabilizationEndTimestamp.sub(timestamp),
        maxStabilizationEndTimestamp: maxStabilizationEndTimestamp,
      };

      parseArguments(LiquidityMiningParams, await bucket.getLiquidityMiningParams());
    });

    it("Should deploy bucket with initial bar calculation params", async function () {
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);

      parseArguments(defaultBarCalcParams, await interestRateStrategy.getBarCalculationParams(bucketAddress));
    });

    it("Should deploy bucket with initial maxTotalDeposit value", async function () {
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);
      const bucket = await getContractAt("Bucket", bucketAddress);

      const realMaxTotalDeposit = await bucket.maxTotalDeposit();
      expect(bucketInitParams.maxTotalDeposit).to.be.equal(realMaxTotalDeposit);
    });

    it("Should revert when withdrawalFeeRate is greater than 10%", async function () {
      bucketInitParams.withdrawalFeeRate = parseEther("0.11");
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "WITHDRAW_RATE_IS_MORE_10_PERCENT",
      );
    });

    it("Should revert when feeBuffer is equal or less than one or more than WAD + WAD / 100", async function () {
      bucketInitParams.feeBuffer = parseEther("1");
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_FEE_BUFFER");
      bucketInitParams.feeBuffer = parseEther("0.9");
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_FEE_BUFFER");
      bucketInitParams.feeBuffer = parseEther("1").add(BigNumber.from(WAD.toString()).div("100"));
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_FEE_BUFFER");
    });

    it("Should revert when reserveRate is equal or greater than one", async function () {
      bucketInitParams.reserveRate = parseEther("1");
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "RESERVE_RATE_SHOULD_BE_LESS_THAN_1",
      );
      bucketInitParams.reserveRate = parseEther("1.1");
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "RESERVE_RATE_SHOULD_BE_LESS_THAN_1",
      );
    });

    it("Should revert when maxTotalDeposit is zero", async function () {
      bucketInitParams.maxTotalDeposit = 0;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "MAX_TOTAL_DEPOSIT_IS_ZERO");
    });

    it("Should revert when liquidityMiningRewardDistributor address is not supported", async function () {
      bucketInitParams.liquidityMiningRewardDistributor = positionManager.address;

      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_LIQUIDITY_MINING_PARAMS",
      );
    });
    it("Should revert when liquidityMiningAmount isn't 0 and liquidityMiningDeadline is 0", async function () {
      bucketInitParams.liquidityMiningDeadline = 0;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_LIQUIDITY_MINING_PARAMS",
      );
    });

    it("Should revert when liquidityMiningAmount isn't 0 and maxAmountPerUser is 0", async function () {
      bucketInitParams.maxAmountPerUser = 0;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_LIQUIDITY_MINING_PARAMS",
      );
    });

    it("Should revert when dns address not supported", async function () {
      await mockPrimexDns.mock.supportsInterface.returns(false);
      bucketInitParams.dns = mockPrimexDns.address;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert bucket deploy when pToken address not supported", async function () {
      await mockPToken.mock.supportsInterface.returns(false);
      await mockPtokensFactory.mock.createPToken.returns(mockPToken.address);

      bucketsFactory = await bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      );
      await bucketsFactory.deployed();

      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert bucket deploy when debtToken address not supported", async function () {
      await mockDebtToken.mock.supportsInterface.returns(false);
      await mockDebtTokensFactory.mock.createDebtToken.returns(mockDebtToken.address);

      bucketsFactory = await bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      );
      await bucketsFactory.deployed();

      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when positionManager address not supported", async function () {
      await mockPositionManager.mock.supportsInterface.returns(false);
      bucketInitParams.positionManager = mockPositionManager.address;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if Reserve address does not support IReserve", async function () {
      await mockReserve.mock.supportsInterface.returns(false);
      bucketInitParams.reserve = mockReserve.address;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if InterestRateStrategy address does not support IInterestRateStrategy", async function () {
      await mockInterestRateStrategy.mock.supportsInterface.returns(false);
      bucketInitParams.interestRateStrategy = mockInterestRateStrategy.address;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    // todo: Should revert if priceOracle address does not support IPriceOracle
    // todo: Should revert if whiteBlackList address does not support IWhiteBlackList

    it("Should revert when asset address is zero", async function () {
      const wrongParam = [AddressZero];
      bucketInitParams.assets = wrongParam;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CAN_NOT_ADD_WITH_ZERO_ADDRESS",
      );
    });

    it("Should revert when decimals of borrowed asset exceeds the max value", async function () {
      await mockErc20.mock.decimals.returns(19);
      bucketInitParams.underlyingAsset = mockErc20.address;
      await expect(bucketsFactory.createBucket(bucketInitParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ASSET_DECIMALS_EXCEEDS_MAX_VALUE",
      );
    });

    it("Should set withdrawalFeeRate during deploy", async function () {
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);
      const bucket = await getContractAt("Bucket", bucketAddress);

      const withdrawalFeeRateFromBucket = await bucket.withdrawalFeeRate();
      expect(withdrawalFeeRateFromBucket).to.equal(withdrawalFeeRate);
    });

    it("Should set the correct values of estimated Bar and Lar during deploy bucket with liquidity mining", async function () {
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);
      const bucket = await getContractAt("Bucket", bucketAddress);
      expect(await bucket.estimatedBar()).to.equal(estimatedBar);
      expect(await bucket.estimatedLar()).to.equal(estimatedLar);
    });
  });

  describe("Set functions", function () {
    let snapshotId;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setBarCalculationParams", async function () {
      await expect(bucket.connect(caller).setBarCalculationParams([])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should set BarCalculationParams and emit BarCalculationParamsChanged event", async function () {
      const paramsInBytes = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(defaultBarCalcParams)]);
      await expect(bucket.connect(deployer).setBarCalculationParams(paramsInBytes))
        .to.emit(interestRateStrategy, "BarCalculationParamsChanged")
        .withArgs(
          bucket.address,
          defaultBarCalcParams.urOptimal,
          defaultBarCalcParams.k0,
          defaultBarCalcParams.k1,
          defaultBarCalcParams.b0,
          defaultBarCalcParams.b1,
        )
        .to.emit(bucket, "BarCalculationParamsChanged")
        .withArgs(paramsInBytes);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setReserveRate", async function () {
      await expect(bucket.connect(caller).setReserveRate(parseEther("0.1"))).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert setReserveRate if reserveRate is equal or greater than one", async function () {
      await expect(bucket.connect(BigTimelockAdmin).setReserveRate(parseEther("1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "RESERVE_RATE_SHOULD_BE_LESS_THAN_1",
      );
      await expect(bucket.connect(BigTimelockAdmin).setReserveRate(parseEther("1.1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "RESERVE_RATE_SHOULD_BE_LESS_THAN_1",
      );
    });

    it("Should be: new reserve Rate set successfully", async function () {
      await bucket.connect(BigTimelockAdmin).setReserveRate(parseEther("0.1"));
      expect(await bucket.reserveRate()).to.be.equal(parseEther("0.1"));
    });
    it("Should emit ReserveRateChanged when reserve rate is changed", async function () {
      const newReserveRate = parseEther("1").div(2);
      await expect(bucket.setReserveRate(newReserveRate)).to.emit(bucket, "ReserveRateChanged").withArgs(newReserveRate);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setFeeBuffer", async function () {
      await expect(bucket.connect(caller).setFeeBuffer(parseEther("1.01"))).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert setFeeBuffer if feeBuffer is equal or less than one", async function () {
      await expect(bucket.connect(MediumTimelockAdmin).setFeeBuffer(parseEther("1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_FEE_BUFFER",
      );
      await expect(bucket.connect(MediumTimelockAdmin).setFeeBuffer(parseEther("0.9"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_FEE_BUFFER",
      );
      await expect(
        bucket.connect(MediumTimelockAdmin).setFeeBuffer(parseEther("1").add(BigNumber.from(WAD.toString()).div("100"))),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_FEE_BUFFER");
    });

    it("Should be: new fee buffer set successfully", async function () {
      await bucket.connect(MediumTimelockAdmin).setFeeBuffer(parseEther("1.0099"));
      expect(await bucket.feeBuffer()).to.be.equal(parseEther("1.0099"));
    });

    it("Should revert setMaxTotalDeposit if maxTotalDeposit is zero", async function () {
      await expect(bucket.connect(MediumTimelockAdmin).setMaxTotalDeposit(0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "MAX_TOTAL_DEPOSIT_IS_ZERO",
      );
    });

    it("Should set maxTotal deposit successfully and emit event", async function () {
      // todo: create 2 separate tests / chech emit and set maxTotalDeposit
      const newMaxTotalDeposit = parseEther("1");
      await expect(bucket.connect(MediumTimelockAdmin).setMaxTotalDeposit(newMaxTotalDeposit))
        .to.emit(bucket, "MaxTotalDepositChanged")
        .withArgs(newMaxTotalDeposit);
      expect(await bucket.maxTotalDeposit()).to.be.equal(newMaxTotalDeposit);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMaxTotalDeposit", async function () {
      await expect(bucket.connect(caller).setMaxTotalDeposit(parseEther("1"))).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setWithdrawalFee", async function () {
      await expect(bucket.connect(caller).setWithdrawalFee(5)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert if new withdrawalFeeRate more or equal WAD/10 (10 percent)", async function () {
      // todo: fix wad x2,need to set WAD/10
      await expect(bucket.setWithdrawalFee(WAD)).to.be.revertedWithCustomError(ErrorsLibrary, "WITHDRAW_RATE_IS_MORE_10_PERCENT");
      await expect(bucket.setWithdrawalFee(WAD)).to.be.revertedWithCustomError(ErrorsLibrary, "WITHDRAW_RATE_IS_MORE_10_PERCENT");
    });

    it("Should set new withdrawalFeeRate", async function () {
      const newWithdrawalFeeRate = BigNumber.from(withdrawalFeeRate).mul(2);
      await bucket.connect(BigTimelockAdmin).setWithdrawalFee(newWithdrawalFeeRate);
      const withdrawalFeeRateFromBucket = await bucket.withdrawalFeeRate();
      expect(withdrawalFeeRateFromBucket).to.equal(newWithdrawalFeeRate);
    });

    it("Should emit WithdrawalFeeChanged when withdrawal fee is changed", async function () {
      const newWithdrawalFeeRate = BigNumber.from(withdrawalFeeRate).mul(2);
      await expect(bucket.setWithdrawalFee(newWithdrawalFeeRate)).to.emit(bucket, "WithdrawalFeeChanged").withArgs(newWithdrawalFeeRate);
    });

    it("Should emit FeeBufferChanged when fee buffer is changed", async function () {
      const newFeeBuffer = parseEther("1.001");
      await expect(bucket.setFeeBuffer(newFeeBuffer)).to.emit(bucket, "FeeBufferChanged").withArgs(newFeeBuffer);
    });
    it("Should revert if not BIG_TIMELOCK_ADMIN call setInterestRateStrategy", async function () {
      await expect(bucket.connect(caller).setInterestRateStrategy(deployer.address));
    });

    it("Should set a new InterestRateStrategy address if it supports IInterestRateStrategy", async function () {
      const newInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
      expect(await bucket.connect(BigTimelockAdmin).setInterestRateStrategy(newInterestRateStrategy.address));
    });

    it("Should emit InterestRateStrategyChanged when interestRateStrategy is changed", async function () {
      const newInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
      await expect(bucket.setInterestRateStrategy(newInterestRateStrategy.address))
        .to.emit(bucket, "InterestRateStrategyChanged")
        .withArgs(newInterestRateStrategy.address);
    });

    it("Should revert if new InterestRateStrategy address does not support IInterestRateStrategy", async function () {
      const newInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
      await newInterestRateStrategy.mock.supportsInterface.returns(false);
      await expect(bucket.setInterestRateStrategy(newInterestRateStrategy.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });
  describe("View functions", function () {
    let snapshotId;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should returns the correct status when the bucket is inactive", async function () {
      await PrimexDNS.freezeBucket(await bucket.name());
      expect(await bucket.isActive()).to.be.equal(false);
      expect(await bucket.isDelisted()).to.be.equal(false);
      expect(await bucket.isDeprecated()).to.be.equal(false);
      expect(await bucket.isWithdrawAfterDelistingAvailable()).to.be.equal(false);
    });

    it("Should returns the correct status when the bucket is active", async function () {
      expect(await bucket.isActive()).to.be.equal(true);
      expect(await bucket.isDelisted()).to.be.equal(false);
      expect(await bucket.isDeprecated()).to.be.equal(false);
      expect(await bucket.isWithdrawAfterDelistingAvailable()).to.be.equal(false);
    });

    it("Should returns the correct status when the bucket is deprecated", async function () {
      await PrimexDNS.deprecateBucket(await bucket.name());
      expect(await bucket.isActive()).to.be.equal(false);
      expect(await bucket.isDelisted()).to.be.equal(false);
      expect(await bucket.isDeprecated()).to.be.equal(true);
      expect(await bucket.isWithdrawAfterDelistingAvailable()).to.be.equal(false);
    });

    it("Should returns the correct status when the current timestamp > delisting deadline", async function () {
      await PrimexDNS.deprecateBucket(await bucket.name());
      await network.provider.send("evm_increaseTime", [(await PrimexDNS.delistingDelay()).add("1").toNumber()]);
      await network.provider.send("evm_mine");
      expect(await bucket.isActive()).to.be.equal(false);
      expect(await bucket.isDelisted()).to.be.equal(true);
      expect(await bucket.isDeprecated()).to.be.equal(true);
      expect(await bucket.isWithdrawAfterDelistingAvailable()).to.be.equal(false);
    });

    it("Should returns the correct status when the current timestamp > admin deadline", async function () {
      await PrimexDNS.deprecateBucket(await bucket.name());
      await network.provider.send("evm_increaseTime", [
        (
          await PrimexDNS.delistingDelay()
        )
          .add(await PrimexDNS.adminWithdrawalDelay())
          .add("1")
          .toNumber(),
      ]);
      await network.provider.send("evm_mine");
      expect(await bucket.isActive()).to.be.equal(false);
      expect(await bucket.isDelisted()).to.be.equal(true);
      expect(await bucket.isDeprecated()).to.be.equal(true);
      expect(await bucket.isWithdrawAfterDelistingAvailable()).to.be.equal(true);
    });
  });

  describe("receiveDeposit", function () {
    let snapshotId;
    let maxTotalDeposit, pTokenSupply;

    before(async function () {
      maxTotalDeposit = parseEther("35");
      pTokenSupply = await pTestTokenA.totalSupply();
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should receiveDeposit if deposit does not exceed maxTotalDeposit", async function () {
      await bucket.setMaxTotalDeposit(maxTotalDeposit);
      const depositAmount = maxTotalDeposit.sub(1);
      const bucketSigner = await getImpersonateSigner(bucket);
      expect(pTokenSupply.add(depositAmount)).to.be.lt(maxTotalDeposit);

      await expect(bucket.connect(bucketSigner).receiveDeposit(deployer.address, depositAmount, 0, await bucket.name())).to.emit(
        bucket,
        "Deposit",
      );
    });

    // todo: add receiveDeposit for deposit to launched bucket
    // todo: add receiveDeposit for deposit to LMbucket

    it("Should revert receiveDeposit if DEPOSIT_EXCEEDS_MAX_TOTAL_DEPOSIT", async function () {
      await bucket.setMaxTotalDeposit(maxTotalDeposit);
      const depositAmount = maxTotalDeposit.add(1);
      expect(pTokenSupply.add(depositAmount)).to.be.gt(maxTotalDeposit);

      await expect(bucket.receiveDeposit(deployer.address, depositAmount, 0, await bucket.name())).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEPOSIT_EXCEEDS_MAX_TOTAL_DEPOSIT",
      );
    });

    // todo: add check for this error "_require(dns.getBucketAddress(_bucketFrom) == msg.sender, Errors.FORBIDDEN.selector);"
    // todo: Should revert receiveDeposit if it's called not by bucket in system)
    //

    it("Should revert receiveDeposit if bucket isn't, check FORBIDDEN error", async function () {
      await bucket.setMaxTotalDeposit(maxTotalDeposit);
      const depositAmount = maxTotalDeposit.sub(1);
      const bucketSigner = await getImpersonateSigner(bucket);
      expect(pTokenSupply.add(depositAmount)).to.be.lt(maxTotalDeposit);

      await expect(bucket.connect(bucketSigner).receiveDeposit(deployer.address, depositAmount, 0, await bucket.name())).to.emit(
        bucket,
        "Deposit",
      );
    });
  });

  describe("withdrawAfterDelisting", function () {
    let snapshotId;
    let deposit;

    before(async function () {
      deposit = parseUnits("100", decimalsA);
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should revert if not BIG_TIMELOCK_ADMIN call withdrawAfterDelisting", async function () {
      await expect(bucket.connect(caller).withdrawAfterDelisting(deposit)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert withdrawAfterDelisting when the bucket status is not time after delisting", async function () {
      await expect(bucket.withdrawAfterDelisting(deposit)).to.be.revertedWithCustomError(ErrorsLibrary, "WITHDRAWAL_NOT_ALLOWED");
    });

    it("Should withdrawAfterDelisting to treasury", async function () {
      await bucket.connect(lender).deposit(lender.address, deposit);

      await PrimexDNS.deprecateBucket(await bucket.name());
      await network.provider.send("evm_increaseTime", [
        (
          await PrimexDNS.delistingDelay()
        )
          .add(await PrimexDNS.adminWithdrawalDelay())
          .add("1")
          .toNumber(),
      ]);
      const treasury = await getContract("Treasury");

      await expect(() => bucket.connect(BigTimelockAdmin).withdrawAfterDelisting(deposit)).to.changeTokenBalances(
        testTokenA,
        [bucket, treasury.address],
        [deposit.mul(NegativeOne), deposit],
      );
    });
  });
  describe("Integration tests LiquidityMining in bucket and LiquidityMiningRewardDistributor", function () {
    let snapshotId, snapshotIdBase;
    let pmx,
      pmxRewardAmount,
      liquidityMiningDeadline,
      stabilizationDuration,
      liquidityMiningAmount,
      maxStabilizationEndTimestamp,
      maxDuration,
      bucket,
      mockWhiteBlackList,
      pTestTokenA;
    before(async function () {
      mockWhiteBlackList = await deployMockWhiteBlackList(deployer);

      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });

      pmx = await getContract("EPMXToken");
      const currentTimestamp = (await provider.getBlock("latest")).timestamp + 100;

      await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);

      liquidityMiningDeadline = currentTimestamp + 24 * 60 * 60;
      stabilizationDuration = 60 * 60;
      liquidityMiningAmount = parseUnits("100", decimalsA);
      maxStabilizationEndTimestamp = liquidityMiningDeadline + stabilizationDuration;
      maxDuration = maxStabilizationEndTimestamp - currentTimestamp;
      pmxRewardAmount = parseUnits("100", await pmx.decimals());

      const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
        nameBucket: "BucketWithLiquidityMining",
        assets: `["${testTokenB.address}"]`,
        pairPriceDrops: "[\"100000000000000000\"]",
        feeBuffer: "1000100000000000000", // 1.0001
        withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
        reserveRate: "100000000000000000", // 0.1 - 10%,
        underlyingAsset: testTokenA.address,
        whiteBlackList: mockWhiteBlackList.address,
        liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
        liquidityMiningAmount: liquidityMiningAmount.toString(),
        liquidityMiningDeadline: liquidityMiningDeadline.toString(),
        maxAmountPerUser: MaxUint256.toString(),
        stabilizationDuration: stabilizationDuration.toString(), // 1 hour
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        pmxRewardAmount: pmxRewardAmount.toString(),
        barCalcParams: JSON.stringify(defaultBarCalcParams),
        maxTotalDeposit: MaxUint256.toString(),
      });
      bucket = await getContractAt("Bucket", newBucketAddress);
      pTestTokenA = await getContractAt("PToken", await bucket.pToken());
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
    });

    it("Should revert openPosition while bucket is not launched", async function () {
      const assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

      await expect(
        openPosition(testTokenA, traderBalanceVault, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_NOT_LAUNCHED");
    });

    it("Should revert receiveDeposit if it's called not by bucket in system", async function () {
      await expect(bucket.receiveDeposit(deployer.address, 100, 0, await bucket.name())).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should openPosition when bucket is launched", async function () {
      await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount);
      await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount);

      const assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
      await openPosition(testTokenA, traderBalanceVault, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes);
    });

    it("Should emit BucketLaunched event when bucket is launched", async function () {
      await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount);
      await expect(bucket.connect(lender).deposit(lender.address, liquidityMiningAmount)).to.emit(bucket, "BucketLaunched");
    });

    it("claimReward should transfer pmx on balance in TraderBalanceVault", async function () {
      const data = [
        { account: deployer, deposit: liquidityMiningAmount.mul(2).div(5) },
        { account: lender, deposit: liquidityMiningAmount.mul(4).div(5) },
      ];
      for (let i = 0; i < data.length; i++) {
        await testTokenA.mint(data[i].account.address, data[i].deposit);
        await testTokenA.connect(data[i].account).approve(bucket.address, data[i].deposit);
        await bucket.connect(data[i].account).deposit(data[i].account.address, data[i].deposit);
      }

      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration + 100]);
      const bucketName = await bucket.name();
      for (let i = 0; i < data.length; i++) {
        const { rewardsInPMX } = await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, data[i].account.address, timestamp);
        const claimReward = await LiquidityMiningRewardDistributor.connect(data[i].account).claimReward(bucketName);
        const { availableBalance } = await traderBalanceVault.balances(data[i].account.address, pmx.address);
        await expect(claimReward).to.changeTokenBalances(
          pmx,
          [LiquidityMiningRewardDistributor, traderBalanceVault],
          [rewardsInPMX.minReward.mul(NegativeOne), rewardsInPMX.minReward],
        );
        expect(availableBalance).to.equal(rewardsInPMX.minReward);
      }
    });

    it("withdrawPmxByAdmin should transfer pmx", async function () {
      const data = [
        { account: deployer, deposit: liquidityMiningAmount.mul(2).div(5) },
        { account: lender, deposit: liquidityMiningAmount.mul(4).div(5) },
      ];
      for (let i = 0; i < data.length; i++) {
        await testTokenA.mint(data[i].account.address, data[i].deposit);
        await testTokenA.connect(data[i].account).approve(bucket.address, data[i].deposit);
        await bucket.connect(data[i].account).deposit(data[i].account.address, data[i].deposit);
      }

      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration + 100]);

      const bucketName = await bucket.name();
      const { rewardsInPMX } = await LiquidityMiningRewardDistributor.getLenderInfo(
        bucketName,
        data[0].account.address,
        (
          await provider.getBlock("latest")
        ).timestamp,
      );
      await LiquidityMiningRewardDistributor.connect(data[0].account).claimReward(bucketName);
      await PrimexDNS.deprecateBucket(bucketName);
      await network.provider.send("evm_increaseTime", [
        (
          await PrimexDNS.delistingDelay()
        )
          .add(await PrimexDNS.adminWithdrawalDelay())
          .add("1")
          .toNumber(),
      ]);
      await network.provider.send("evm_mine");
      const treasury = await getContract("Treasury");
      await expect(() => LiquidityMiningRewardDistributor.withdrawPmxByAdmin(bucketName)).to.changeTokenBalances(
        pmx,
        [LiquidityMiningRewardDistributor, treasury],
        [pmxRewardAmount.sub(rewardsInPMX.minReward).mul(NegativeOne), pmxRewardAmount.sub(rewardsInPMX.minReward)],
      );
    });

    describe("deposit", function () {
      let snapshotId;

      beforeEach(async function () {
        snapshotId = await network.provider.request({
          method: "evm_snapshot",
          params: [],
        });
      });

      afterEach(async function () {
        snapshotId = await network.provider.request({
          method: "evm_revert",
          params: [snapshotId],
        });
      });
      it("Should revert when the msg.sender is on the blacklist", async function () {
        await mockWhiteBlackList.mock.isBlackListed.returns(true);
        await expect(bucket.deposit(deployer.address, 100)).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
      });

      it("Should revert when liquidityMiningDeadline is passed", async function () {
        await network.provider.send("evm_setNextBlockTimestamp", [liquidityMiningDeadline + 1]);
        await testTokenA.mint(deployer.address, 100);
        await testTokenA.approve(bucket.address, 100);

        await expect(bucket.deposit(deployer.address, 100)).to.be.revertedWithCustomError(ErrorsLibrary, "DEADLINE_IS_PASSED");
      });

      it("Should revert when user deposit is more than maxAmountPerUser", async function () {
        const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
          nameBucket: "BucketWithLiquidityMining&maxAmountPerUser",
          assets: `["${testTokenB.address}"]`,
          pairPriceDrops: "[\"100000000000000000\"]",
          feeBuffer: parseEther("1.0001").toString(),
          reserveRate: parseEther("0.1").toString(), // 10%,
          underlyingAsset: testTokenA.address,
          liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
          liquidityMiningAmount: liquidityMiningAmount.toString(),
          liquidityMiningDeadline: liquidityMiningDeadline.toString(),
          maxAmountPerUser: liquidityMiningAmount.div(2).toString(),
          stabilizationDuration: stabilizationDuration.toString(), // 1 hour
          pmxRewardAmount: pmxRewardAmount.toString(),
          withdrawalFeeRate: "0",
          estimatedBar: estimatedBar,
          estimatedLar: estimatedLar,
          barCalcParams: JSON.stringify(defaultBarCalcParams),
          maxTotalDeposit: MaxUint256.toString(),
        });
        const bucket = await getContractAt("Bucket", newBucketAddress);
        await testTokenA.mint(deployer.address, liquidityMiningAmount);
        await testTokenA.approve(newBucketAddress, liquidityMiningAmount);
        await expect(bucket.deposit(deployer.address, liquidityMiningAmount)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "DEPOSIT_IS_MORE_AMOUNT_PER_USER",
        );
      });

      it("Should transfer underlying asset and mint ptokens", async function () {
        const depositAmount = BigNumber.from(100);
        const accounts = [lender, deployer, caller];
        for (let i = 0; i < 10; i++) {
          const accountO = accounts[i % 3];
          const depositAmountI = depositAmount.mul(i + 1);
          await testTokenA.mint(accountO.address, depositAmountI);
          await testTokenA.connect(accountO).approve(bucket.address, depositAmountI);

          const balanceBefore = await pTestTokenA.balanceOf(accountO.address);
          await expect(() => bucket.connect(accountO).deposit(accountO.address, depositAmountI)).to.changeTokenBalances(
            testTokenA,
            [accountO, bucket],
            [depositAmountI.mul(NegativeOne), depositAmountI],
          );
          const balanceAfter = await pTestTokenA.balanceOf(accountO.address);
          expect(balanceAfter.sub(balanceBefore)).to.equal(depositAmountI);
        }
      });

      function calculatePoints(currentTimestamp, miningAmount) {
        let points = miningAmount.mul(maxStabilizationEndTimestamp - currentTimestamp).toString();
        points = wadDiv(points, maxDuration.toString()).toString();
        return points;
      }

      async function getRewards(lendersPoints, currentTimestamp) {
        const LMparams = await bucket.getLiquidityMiningParams();
        const availableLiquidity = await bucket.availableLiquidity();
        const stabilizationDuration = BigNumber.from(LMparams.stabilizationDuration);
        const tokensLeft = LMparams.isBucketLaunched
          ? BigNumber.from(0)
          : BigNumber.from(LMparams.accumulatingAmount).sub(availableLiquidity);
        const { totalPoints } = await LiquidityMiningRewardDistributor.getBucketInfo(await bucket.name());

        const period = BigNumber.from(LMparams.maxStabilizationEndTimestamp).sub(BigNumber.from(currentTimestamp));
        const maxExpectedPoints = totalPoints.add(
          BigNumber.from(wadDiv(tokensLeft.mul(period).toString(), LMparams.maxDuration.toString()).toString()),
        );
        const minExpectedPoints = totalPoints.add(
          BigNumber.from(wadDiv(tokensLeft.mul(stabilizationDuration).toString(), LMparams.maxDuration.toString()).toString()),
        );

        const minReward = lendersPoints.mul(pmxRewardAmount).div(maxExpectedPoints);
        const maxReward = lendersPoints.mul(pmxRewardAmount).div(minExpectedPoints);

        return [minReward, maxReward, 0];
      }

      it("Shouldn't revert and should launch bucket when tranfer asset in bucket without deposit", async function () {
        await testTokenA.mint(lender.address, liquidityMiningAmount.mul(2));
        await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount.mul(2));

        const currentTimestamp = (await provider.getBlock("latest")).timestamp + 500;
        await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);

        await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount.mul(2));

        const { isBucketLaunched, stabilizationEndTimestamp } = await bucket.getLiquidityMiningParams();

        expect(isBucketLaunched).to.equal(true);
        expect(stabilizationEndTimestamp).to.equal(stabilizationDuration + currentTimestamp);
      });

      it("Should update only msg.sender info in LiquidityMiningRewardDistributor(pTokenReceiver parameter is unusable argument in liquidity mining phase)", async function () {
        const amount = "1.111111111111111111";

        const depositAmount = parseUnits(Number(amount).toFixed(decimalsA), decimalsA);

        await testTokenA.mint(lender.address, depositAmount);
        await testTokenA.connect(lender).approve(bucket.address, depositAmount);

        const currentTimestamp = (await provider.getBlock("latest")).timestamp + 500;

        const points = await calculatePoints(currentTimestamp, depositAmount);

        await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);
        await bucket.connect(lender).deposit(lender.address, depositAmount);

        const expectedRewards = await getRewards(BigNumber.from(points), currentTimestamp);

        const lenderInfo = await LiquidityMiningRewardDistributor.getLenderInfo(await bucket.name(), lender.address, currentTimestamp);
        const currentPercent = WAD;
        parseArguments([depositAmount, currentPercent, expectedRewards], lenderInfo);

        const pTokenReceiverInfo = await LiquidityMiningRewardDistributor.getLenderInfo(
          await bucket.name(),
          deployer.address,
          currentTimestamp,
        );
        parseArguments([0, 0, [0, 0, 0]], pTokenReceiverInfo);
      });

      it("Should revert deposit if user is not pToken receiver and isBucketLaunched equal false", async function () {
        const depositAmount = parseUnits("100", decimalsA);
        await testTokenA.mint(lender.address, depositAmount);
        await testTokenA.connect(lender).approve(bucket.address, depositAmount);
        await expect(bucket.connect(lender).deposit(trader.address, depositAmount)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "CALLER_IS_NOT_P_TOKEN_RECEIVER",
        );
      });

      it("Should update trader info in LiquidityMiningRewardDistributor", async function () {
        const amount = "1.111111111111111111";

        const depositAmount = parseUnits(Number(amount).toFixed(decimalsA), decimalsA);
        const accounts = [
          { account: lender, points: BigNumber.from(0), miningAmount: BigNumber.from(0) },
          { account: deployer, points: BigNumber.from(0), miningAmount: BigNumber.from(0) },
          { account: caller, points: BigNumber.from(0), miningAmount: BigNumber.from(0) },
        ];
        const bucketName = await bucket.name();
        const timeStep = BigNumber.from(500);

        let totalDeposit = BigNumber.from(0);
        let totalPoints = BigNumber.from(0);

        const cases = [false, false, false];

        for (let i = 0; i < 15; i++) {
          const account = accounts[i % 3].account;
          let userPoints = accounts[i % 3].points;
          let miningAmount = accounts[i % 3].miningAmount;

          const depositAmountI = depositAmount.mul(i + 1);
          await testTokenA.mint(account.address, depositAmountI);
          await testTokenA.connect(account).approve(bucket.address, depositAmountI);

          const currentTimestamp = (await provider.getBlock("latest")).timestamp + timeStep.mul(i + 1).toNumber();
          let points;
          if (totalDeposit.gte(liquidityMiningAmount)) {
            cases[0] = true;
          } else {
            let currentMiningAmount;
            if (totalDeposit.add(depositAmountI).gte(liquidityMiningAmount)) {
              cases[1] = true;
              currentMiningAmount = liquidityMiningAmount.sub(totalDeposit);
              points = calculatePoints(currentTimestamp, currentMiningAmount);
            } else {
              cases[2] = true;
              currentMiningAmount = depositAmountI;
              points = calculatePoints(currentTimestamp, currentMiningAmount);
            }
            userPoints = userPoints.add(points);
            totalPoints = totalPoints.add(points);
            miningAmount = miningAmount.add(currentMiningAmount);
          }

          await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);
          await bucket.connect(account).deposit(account.address, depositAmountI);

          const expectedRewards = await getRewards(BigNumber.from(userPoints), currentTimestamp);

          const { amountInMining, currentPercent, rewardsInPMX } = await LiquidityMiningRewardDistributor.getLenderInfo(
            bucketName,
            account.address,
            currentTimestamp,
          );

          expect(wadDiv(userPoints.toString(), totalPoints.toString()).toString()).to.equal(currentPercent);
          expect(expectedRewards).to.deep.equal(rewardsInPMX);
          expect(miningAmount).to.equal(amountInMining);

          const LMparams = await bucket.getLiquidityMiningParams();
          if (LMparams.isBucketLaunched) {
            const availableLiquidity = await bucket.availableLiquidity();
            expect(availableLiquidity).gte(LMparams.accumulatingAmount);
            expect(rewardsInPMX.minReward).to.equal(rewardsInPMX.maxReward);
          }

          accounts[i % 3].points = userPoints;
          accounts[i % 3].miningAmount = miningAmount;
          totalDeposit = await testTokenA.balanceOf(bucket.address);
        }
        parseArguments([true, true, true], cases);
      });
    });

    describe("withdraw", function () {
      let snapshotId, snapshotIdBase;
      let depositAmount;
      before(async function () {
        snapshotIdBase = await network.provider.request({
          method: "evm_snapshot",
          params: [],
        });

        depositAmount = BigNumber.from(100);
        await testTokenA.connect(lender).approve(bucket.address, depositAmount);
        await bucket.connect(lender).deposit(lender.address, depositAmount);
      });
      beforeEach(async function () {
        snapshotId = await network.provider.request({
          method: "evm_snapshot",
          params: [],
        });
      });

      afterEach(async function () {
        snapshotId = await network.provider.request({
          method: "evm_revert",
          params: [snapshotId],
        });
      });
      after(async function () {
        await network.provider.request({
          method: "evm_revert",
          params: [snapshotIdBase],
        });
      });
      it("Should revert withdraw when the msg.sender is on the blacklist", async function () {
        await mockWhiteBlackList.mock.isBlackListed.returns(true);
        await expect(bucket.connect(lender).withdraw(lender.address, MaxUint256)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "SENDER_IS_BLACKLISTED",
        );
      });

      it("Should correct update LM amount if withdraw before launch bucket", async function () {
        const percents = ["1", "33", "76", "99"];
        // todo: add 0 and 100 percent
        let amountInMining = depositAmount;

        for (const percent of percents) {
          const amountToWithdraw = amountInMining.mul(percent).div("100");
          amountInMining = amountInMining.sub(amountToWithdraw);
          const amountInLM = await LiquidityMiningRewardDistributor.getLenderAmountInMining(await bucket.name(), lender.address);
          await bucket.connect(lender).withdraw(lender.address, amountToWithdraw);
          const amountInLMAfter = await LiquidityMiningRewardDistributor.getLenderAmountInMining(await bucket.name(), lender.address);
          expect(amountInLMAfter).to.equal(amountInLM.sub(amountToWithdraw));
        }
      });

      it("Withdraw should be success if _amount is magic number(MaxUint256)", async function () {
        await bucket.connect(lender).withdraw(lender.address, MaxUint256);
      });

      it("Should NOT update indexes and rates when the bucket is not launched", async function () {
        const tx = await bucket.connect(lender).withdraw(lender.address, depositAmount.div(2));
        const bar = await bucket.bar();
        const lar = await bucket.lar();
        const variableBorrowIndex = await bucket.variableBorrowIndex();
        const liquidityIndex = await bucket.liquidityIndex();

        const { isBucketLaunched } = await bucket.getLiquidityMiningParams();

        const txReceipt = await tx.wait();
        const events = txReceipt.events?.filter(x => {
          return x.event === "RatesIndexesUpdated";
        });

        expect(isBucketLaunched).to.equal(false);
        expect(events.length).to.equal(0);
        expect(bar).to.equal(Zero);
        expect(lar).to.equal(Zero);
        expect(variableBorrowIndex).to.equal(RAY.toString());
        expect(liquidityIndex).to.equal(RAY.toString());
      });
      it("Should revert withdraw if bucket is launched but stabilizationDuration isn't passed and user withdraws its mining liquidity amount", async function () {
        await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount);

        const tx = await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount);
        const timestamp = (await provider.getBlock(tx.blockNumber)).timestamp;

        const { isBucketLaunched } = await bucket.getLiquidityMiningParams();
        expect(isBucketLaunched).to.equal(true);

        await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration / 2]);
        await expect(bucket.connect(lender).withdraw(lender.address, liquidityMiningAmount.div(2))).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "MINING_AMOUNT_WITHDRAW_IS_LOCKED_ON_STABILIZATION_PERIOD",
        );
      });

      // todo: Should revert withdraw if bucket is launched but stabilizationDuration isn't passed and user withdraws its full amount (mining liquidity amount  + stabilization amount)
      it("Shouldn't reset to zero all user points if bucket is launched, stabilizationDuration hasn't passed and user withdraws amount not participated in liquidity mining event", async function () {
        await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount.mul(2));

        const tx = await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount.mul(2));
        const timestamp = (await provider.getBlock(tx.blockNumber)).timestamp;

        const { isBucketLaunched } = await bucket.getLiquidityMiningParams();
        expect(isBucketLaunched).to.equal(true);

        const traderInfo0 = await LiquidityMiningRewardDistributor.getLenderInfo(await bucket.name(), lender.address, timestamp);

        await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration / 2]);
        await bucket.connect(lender).withdraw(lender.address, liquidityMiningAmount);

        const traderInfo1 = await LiquidityMiningRewardDistributor.getLenderInfo(
          await bucket.name(),
          lender.address,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
        parseArguments(traderInfo0, traderInfo1);
      });

      it("Shouldn't reset to zero all user points if bucket is launch and stabilizationDuration is passed", async function () {
        await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount);

        const tx = await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount);
        const timestamp = (await provider.getBlock(tx.blockNumber)).timestamp;

        const { isBucketLaunched } = await bucket.getLiquidityMiningParams();
        expect(isBucketLaunched).to.equal(true);

        const traderInfo0 = await LiquidityMiningRewardDistributor.getLenderInfo(await bucket.name(), lender.address, timestamp);

        await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration + 100]);
        await bucket.connect(lender).withdraw(lender.address, MaxUint256);

        const traderInfo1 = await LiquidityMiningRewardDistributor.getLenderInfo(
          await bucket.name(),
          lender.address,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );

        parseArguments(traderInfo0, traderInfo1);
      });

      it("Should withdraw from bucket and top up withdrawer balance and treasury balance", async function () {
        const treasury = await getContract("Treasury");

        await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount);
        const tx = await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount);
        const timestamp = (await provider.getBlock(tx.blockNumber)).timestamp;

        const lenderBalanceBefore = await testTokenA.balanceOf(lender.address);
        const treasuryBalanceBefore = await testTokenA.balanceOf(treasury.address);
        const bucketBalanceBefore = await testTokenA.balanceOf(bucket.address);

        const amountToWithdraw = liquidityMiningAmount;
        await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration + 100]);
        await bucket.connect(lender).withdraw(lender.address, amountToWithdraw);

        const lenderBalanceAfter = await testTokenA.balanceOf(lender.address);
        const treasuryBalanceAfter = await testTokenA.balanceOf(treasury.address);
        const bucketBalanceAfter = await testTokenA.balanceOf(bucket.address);

        const actualAmountTransferredToLender = lenderBalanceAfter.sub(lenderBalanceBefore);
        const actualAmountTransferredToTreasury = treasuryBalanceAfter.sub(treasuryBalanceBefore);
        const actualAmountTransferredFromBucket = bucketBalanceBefore.sub(bucketBalanceAfter);

        const particleToLender = BigNumber.from(WAD).sub(BigNumber.from(withdrawalFeeRate));
        const expectedAmountTransferredToLender = BigNumber.from(
          wadMul(particleToLender.toString(), amountToWithdraw.toString()).toString(),
        );
        const expectedAmountTransferredToTreasury = amountToWithdraw.sub(expectedAmountTransferredToLender);
        expect(actualAmountTransferredToLender).to.equal(expectedAmountTransferredToLender);
        expect(actualAmountTransferredToTreasury).to.equal(expectedAmountTransferredToTreasury);
        expect(actualAmountTransferredFromBucket).to.equal(amountToWithdraw);
        expect(actualAmountTransferredToLender.add(actualAmountTransferredToTreasury)).to.equal(amountToWithdraw);
      });

      it("Should emit TopUpTreasury event", async function () {
        await testTokenA.connect(lender).approve(bucket.address, liquidityMiningAmount);
        const tx0 = await bucket.connect(lender).deposit(lender.address, liquidityMiningAmount);
        const timestamp = (await provider.getBlock(tx0.blockNumber)).timestamp;

        const amountToWithdraw = liquidityMiningAmount;
        const particleToLender = BigNumber.from(WAD).sub(BigNumber.from(withdrawalFeeRate));
        const expectedAmountTransferredToLender = BigNumber.from(
          wadMul(particleToLender.toString(), amountToWithdraw.toString()).toString(),
        );
        const expectedAmountTransferredToTreasury = amountToWithdraw.sub(expectedAmountTransferredToLender);
        await network.provider.send("evm_setNextBlockTimestamp", [timestamp + stabilizationDuration + 100]);
        const tx = await bucket.connect(lender).withdraw(lender.address, amountToWithdraw);
        await expect(tx).to.emit(bucket, "TopUpTreasury").withArgs(lender.address, expectedAmountTransferredToTreasury);
      });
    });

    // todo: add test Should revert withdraw when the msg.sender is on the blacklist

    describe("depositFromBucket and receiveDeposit integrations tests", function () {
      let snapshotId, snapshotIdBase;
      let depositAmount, swapManager, bucketSame, bucketSameName, PTokenSame, bucketOther, bucketOtherName;
      before(async function () {
        snapshotIdBase = await network.provider.request({
          method: "evm_snapshot",
          params: [],
        });
        swapManager = await getContract("SwapManager");
        depositAmount = BigNumber.from(100);
        await testTokenA.connect(lender).approve(bucket.address, depositAmount);
        await bucket.connect(lender).deposit(lender.address, depositAmount);
        const currentTimestamp = liquidityMiningDeadline + 1;
        await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);

        const liquidityMiningDeadline2 = currentTimestamp + 24 * 60 * 60;

        bucketSameName = "The same underlyingAsset";
        const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
          nameBucket: bucketSameName,
          assets: `["${testTokenB.address}"]`,
          pairPriceDrops: "[\"100000000000000000\"]",
          feeBuffer: "1000100000000000000", // 1.0001
          withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
          reserveRate: "100000000000000000", // 0.1 - 10%,
          underlyingAsset: testTokenA.address,
          liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
          liquidityMiningAmount: liquidityMiningAmount.toString(),
          liquidityMiningDeadline: liquidityMiningDeadline2.toString(),
          maxAmountPerUser: MaxUint256.toString(),
          stabilizationDuration: stabilizationDuration.toString(), // 1 hour
          estimatedBar: estimatedBar,
          estimatedLar: estimatedLar,
          pmxRewardAmount: pmxRewardAmount.toString(),
          barCalcParams: JSON.stringify(defaultBarCalcParams),
          maxTotalDeposit: MaxUint256.toString(),
        });
        bucketSame = await getContractAt("Bucket", newBucketAddress);
        PTokenSame = await getContractAt("PToken", await bucketSame.pToken());

        await priceOracle.setPairPriceDrop(
          testTokenA.address,
          testTokenB.address,
          await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address),
        );

        bucketOtherName = "other underlyingAsset";
        const { newBucket: newBucketAddress2 } = await run("deploy:Bucket", {
          nameBucket: bucketOtherName,
          assets: `["${testTokenA.address}"]`,
          pairPriceDrops: "[\"100000000000000000\"]",
          feeBuffer: "1000100000000000000", // 1.0001
          withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%

          reserveRate: "100000000000000000", // 0.1 - 10%,
          underlyingAsset: testTokenB.address,
          liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
          liquidityMiningAmount: liquidityMiningAmount.toString(),
          liquidityMiningDeadline: liquidityMiningDeadline2.toString(),
          maxAmountPerUser: MaxUint256.toString(),
          stabilizationDuration: stabilizationDuration.toString(), // 1 hour
          estimatedBar: estimatedBar,
          estimatedLar: estimatedLar,
          pmxRewardAmount: pmxRewardAmount.toString(),
          barCalcParams: JSON.stringify(defaultBarCalcParams),
          maxTotalDeposit: MaxUint256.toString(),
        });
        bucketOther = await getContractAt("Bucket", newBucketAddress2);
      });
      beforeEach(async function () {
        snapshotId = await network.provider.request({
          method: "evm_snapshot",
          params: [],
        });
      });

      afterEach(async function () {
        snapshotId = await network.provider.request({
          method: "evm_revert",
          params: [snapshotId],
        });
      });
      after(async function () {
        await network.provider.request({
          method: "evm_revert",
          params: [snapshotIdBase],
        });
      });
      it("Should revert depositFromBucket when the msg.sender is on the blacklist", async function () {
        await mockWhiteBlackList.mock.isBlackListed.returns(true);
        await expect(
          bucket.connect(lender).depositFromBucket(await bucket.name(), swapManager.address, [], 0),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
      });

      it("Should revert depositFromBucket in bucket from which this function is called", async function () {
        await expect(bucket.connect(lender).depositFromBucket(await bucket.name(), swapManager.address, [], 0)).to.be.revertedWith(
          "ReentrancyGuard: reentrant call",
        );
      });

      it("Should revert depositFromBucket when bucket is launched", async function () {
        await testTokenA.connect(lender).approve(bucketSame.address, liquidityMiningAmount);
        await bucketSame.connect(lender).deposit(lender.address, liquidityMiningAmount);
        expect((await bucketSame.getLiquidityMiningParams()).isBucketLaunched).to.equal(true);
        await expect(
          bucketSame.connect(lender).depositFromBucket(await bucket.name(), swapManager.address, [], 0),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DEADLINE_IS_NOT_PASSED");
      });
      it("Should revert depositFromBucket when bucket isn't launched and deadline isn't passed", async function () {
        await testTokenA.connect(lender).approve(bucketSame.address, liquidityMiningAmount.div(2));
        await bucketSame.connect(lender).deposit(lender.address, liquidityMiningAmount.div(2));
        expect((await bucketSame.getLiquidityMiningParams()).isBucketLaunched).to.equal(false);
        await expect(
          bucketSame.connect(lender).depositFromBucket(await bucket.name(), swapManager.address, [], 0),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DEADLINE_IS_NOT_PASSED");
      });

      it("Should revert depositFromBucket when bucketTo1 is bucket with other asset and swapManager doesn't have VAULT_ACCESS_ROLE", async function () {
        const hackedSwapManaer = lender.address;
        await expect(bucket.connect(lender).depositFromBucket(bucketOtherName, hackedSwapManaer, [], 0)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });

      it("depositFromBucket works after partial withdrawal from bucket", async function () {
        const amount = await pTestTokenA.balanceOf(lender.address);
        await bucket.connect(lender).withdraw(lender.address, amount.div(3));

        await bucket.connect(lender).depositFromBucket(bucketSameName, swapManager.address, [], 0);
      });

      it("depositFromBucket should burn user's ptoken in this bucket and mint ptokens on user address in receiverBucket", async function () {
        const amount = await pTestTokenA.balanceOf(lender.address);
        await bucket.connect(lender).depositFromBucket(bucketSameName, swapManager.address, [], 0);

        expect(await pTestTokenA.balanceOf(lender.address)).to.equal(0);
        expect(await PTokenSame.balanceOf(lender.address)).to.equal(amount);
      });

      it("depositFromBucket should transfer underlying asset from this bucket to receiverBucket", async function () {
        const amount = await pTestTokenA.balanceOf(lender.address);
        await expect(() => bucket.connect(lender).depositFromBucket(bucketSameName, swapManager.address, [], 0)).to.be.changeTokenBalances(
          testTokenA,
          [bucket, bucketSame],
          [amount.mul(NegativeOne), amount],
        );
      });

      it("depositFromBucket should swap and transfer underlying asset from this bucket to receiverBucket if assets of buckets are different", async function () {
        const amount = await pTestTokenA.balanceOf(lender.address);
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseUnits("10000000000", decimalsB).toString(),
          path: [testTokenB.address, testTokenA.address],
        });
        const amountBOut = await getAmountsOut(dex, amount, [testTokenA.address, testTokenB.address]);
        const route = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

        await expect(() =>
          bucket.connect(lender).depositFromBucket(bucketOtherName, swapManager.address, route, 0),
        ).to.be.changeTokenBalance(testTokenB, bucketOther, amountBOut);
      });

      it("depositFromBucket should add extra reward in receiverBucket", async function () {
        const timestamp = (await provider.getBlock("latest")).timestamp;
        const {
          rewardsInPMX: { minReward },
        } = await LiquidityMiningRewardDistributor.getLenderInfo(await bucket.name(), lender.address, timestamp);

        await bucket.connect(lender).depositFromBucket(bucketSameName, swapManager.address, [], 0);
        const {
          rewardsInPMX: { extraReward },
        } = await LiquidityMiningRewardDistributor.getLenderInfo(bucketSameName, lender.address, timestamp);
        expect(minReward).to.equal(extraReward);
      });

      it("if receiverBucket is launched do locked deposit and immediately claim extra reward to balance in traderBalanceVault", async function () {
        const timestamp = (await provider.getBlock("latest")).timestamp;

        await testTokenA.connect(lender).approve(bucketSame.address, liquidityMiningAmount);
        await bucketSame.connect(lender).deposit(lender.address, liquidityMiningAmount);
        expect((await bucketSame.getLiquidityMiningParams()).isBucketLaunched).to.equal(true);
        const {
          rewardsInPMX: { minReward: reward },
        } = await LiquidityMiningRewardDistributor.getLenderInfo(await bucket.name(), lender.address, timestamp);

        const amount = await pTestTokenA.balanceOf(lender.address);
        const { availableBalance: balanceBefore } = await traderBalanceVault.balances(lender.address, pmx.address);

        const tx = await bucket.connect(lender).depositFromBucket(bucketSameName, swapManager.address, [], 0);
        const timestampAfterTx = (await provider.getBlock("latest")).timestamp;

        const { availableBalance: balanceAfter } = await traderBalanceVault.balances(lender.address, pmx.address);

        const expectedLockDepositEvent = Object.values({
          user: lender.address,
          id: 0,
          deadline: timestampAfterTx + stabilizationDuration,
          amount: amount,
        });
        const expectedDepositInBucket = Object.values({
          depositer: bucket.address,
          pTokenReceiver: lender.address,
          amount: amount,
        });

        await expect(tx)
          .to.emit(PTokenSame, "LockDeposit")
          .withArgs(...expectedLockDepositEvent);
        await expect(tx)
          .to.emit(bucketSame, "Deposit")
          .withArgs(...expectedDepositInBucket);

        expect(balanceAfter.sub(balanceBefore)).to.equal(reward);

        expect(await pTestTokenA.availableBalanceOf(lender.address)).to.equal(0);
      });

      // todo: add test when isInvestEnabled - True and aaveDeposit > 0 - should withdraw Liquidity From Aave and transfer from this bucket to receiverBucket
      // todo: Should emit Withdraw when depositFromBucket doing
      it("Should calculate available pToken balance without amount in liquidity mining during stabilization period", async function () {
        const half = liquidityMiningAmount.div(2);
        const traderDepositedInLM = liquidityMiningAmount.sub(half);
        const lenderDepositedInLM = liquidityMiningAmount;

        await testTokenA.connect(lender).approve(bucketSame.address, liquidityMiningAmount);
        await testTokenA.connect(trader).approve(bucketSame.address, liquidityMiningAmount);
        await bucketSame.connect(trader).deposit(trader.address, traderDepositedInLM);
        await bucketSame.connect(lender).deposit(lender.address, lenderDepositedInLM);

        const actualLenderAmountInLm = liquidityMiningAmount.sub(traderDepositedInLM);
        expect((await bucketSame.getLiquidityMiningParams()).isBucketLaunched).to.equal(true);
        const locked = parseEther("0.5");

        const bucketSigner = await getImpersonateSigner(bucketSame);
        await PTokenSame.connect(bucketSigner).lockDeposit(lender.address, locked, 600);

        const pTokensLender = await PTokenSame.availableBalanceOf(lender.address);
        const pTokensTrader = await PTokenSame.availableBalanceOf(trader.address);

        const expectedLenderAvailableBalance = lenderDepositedInLM.sub(actualLenderAmountInLm).sub(locked);
        expect(pTokensLender).to.equal(expectedLenderAvailableBalance);
        expect(pTokensTrader).to.equal(0);
      });
    });
  });

  describe("maxAssetLeverage", function () {
    let snapshotId;

    before(async function () {
      await bucket.setFeeBuffer(feeBuffer); // 1.0002
      maintenanceBuffer = await positionManager.maintenanceBuffer();
      securityBuffer = await positionManager.securityBuffer();
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should not return maxAssetLeverage when asset is not supported", async function () {
      await expect(bucket.maxAssetLeverage(testTokenY.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_IS_NOT_SUPPORTED");
    });

    const pairPriceDrops = [
      "5579573088000000",
      "10257147340000000",
      "7093387670000000",
      "35575560000000000",
      "40140200410000000",
      "22460896490000000",
    ];

    it("Should return the correct max leverage when the asset isn't equal to the deposit asset and the position asset", async function () {
      for (let i = 0; i < pairPriceDrops.length; i++) {
        oracleTolerableLimitAB = await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenB.address);
        oracleTolerableLimitBA = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

        await priceOracle.setPairPriceDrop(testTokenB.address, testTokenA.address, BigNumber.from(pairPriceDrops[i]));
        const maxLeverage = calculateMaxAssetLeverage(
          BigNumber.from(feeBuffer),
          maintenanceBuffer,
          securityBuffer,
          BigNumber.from(pairPriceDrops[i]),
          oracleTolerableLimitAB,
          oracleTolerableLimitBA,
        );
        expect(await bucket.maxAssetLeverage(testTokenB.address)).to.equal(maxLeverage);
      }
    });
    it("Should return the correct max leverage when the asset is equal to the deposit asset or position asset", async function () {
      for (let i = 0; i < pairPriceDrops.length; i++) {
        oracleTolerableLimitAB = await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenB.address);
        oracleTolerableLimitBA = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
        await priceOracle.setPairPriceDrop(testTokenB.address, testTokenA.address, BigNumber.from(pairPriceDrops[i]));
        const maxLeverage = calculateMaxAssetLeverage(
          feeBuffer,
          maintenanceBuffer,
          securityBuffer,
          pairPriceDrops[i],
          oracleTolerableLimitAB,
          oracleTolerableLimitBA,
        );
        expect(await bucket.maxAssetLeverage(testTokenB.address)).to.equal(maxLeverage);
      }
    });
  });

  describe("allowedAssetList", function () {
    let snapshotId;
    before(async function () {
      await priceOracle.updatePriceFeed(testTokenX.address, USD, priceFeed.address);
      await priceOracle.updatePriceFeed(testTokenY.address, USD, priceFeed.address);
      await priceOracle.updatePriceFeed(testTokenZ.address, USD, priceFeed.address);
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call addAsset", async function () {
      await expect(bucket.connect(caller).addAsset(testTokenB.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert if not SMALL_TIMELOCK_ADMIN call removeAsset", async function () {
      await expect(bucket.connect(caller).removeAsset(testTokenB.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert if no price feed found", async function () {
      const pairPriceDrop = new BN(WAD).multipliedBy(0.01).toFixed();
      await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);
      await priceOracle.updatePriceFeed(testTokenX.address, USD, AddressZero);
      await expect(bucket.addAsset(testTokenX.address)).to.be.revertedWithCustomError(ErrorsLibrary, "NO_PRICEFEED_FOUND");
    });

    it("Should allow to add asset only when priceDrop of asset relative to borrowed asset > 0", async function () {
      await expect(bucket.addAsset(testTokenX.address)).to.be.revertedWithCustomError(ErrorsLibrary, "PAIR_PRICE_DROP_IS_NOT_CORRECT");
    });

    it("Should add token to allowed for deals token list in constructor", async function () {
      const pairPriceDrop = new BN(WAD).multipliedBy(0.1).toString();
      const assets = await bucket.getAllowedAssets();
      expect(assets.length).to.equal(1);
      expect(assets[0]).to.be.equal(testTokenB.address);

      const allowedAsset = await bucket.allowedAssets(testTokenB.address);
      expect(allowedAsset.index).to.equal(0);
      expect(allowedAsset.isSupported).to.equal(true);
      expect(await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address)).to.equal(pairPriceDrop);
    });

    it("Should add few tokens to allowed for deals token list", async function () {
      const pairPriceDrop1 = new BN(WAD).multipliedBy(0.01).toFixed();
      const pairPriceDrop2 = new BN(WAD).multipliedBy(0.09).toFixed();
      const pairPriceDrop3 = new BN(WAD).multipliedBy(0.2).toFixed();

      await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop1);
      await priceOracle.setPairPriceDrop(testTokenY.address, testTokenA.address, pairPriceDrop2);
      await priceOracle.setPairPriceDrop(testTokenZ.address, testTokenA.address, pairPriceDrop3);

      await bucket.connect(MediumTimelockAdmin).addAsset(testTokenX.address);
      await bucket.connect(MediumTimelockAdmin).addAsset(testTokenY.address);
      await bucket.connect(MediumTimelockAdmin).addAsset(testTokenZ.address);
      expect((await bucket.getAllowedAssets()).length).to.equal(4); // 3 + initially assets(now 1)
      expect((await bucket.getAllowedAssets())[1]).to.equal(testTokenX.address);
      expect((await bucket.getAllowedAssets())[2]).to.equal(testTokenY.address);
      expect((await bucket.getAllowedAssets())[3]).to.equal(testTokenZ.address);

      const allowedAssetX = await bucket.allowedAssets(testTokenX.address);
      expect(allowedAssetX.index).to.equal(1);
      expect(allowedAssetX.isSupported).to.equal(true);
      expect(await priceOracle.pairPriceDrops(testTokenX.address, testTokenA.address)).to.equal(pairPriceDrop1);

      const allowedAssetY = await bucket.allowedAssets(testTokenY.address);
      expect(allowedAssetY.index).to.equal(2);
      expect(allowedAssetY.isSupported).to.equal(true);
      expect(await priceOracle.pairPriceDrops(testTokenY.address, testTokenA.address)).to.equal(pairPriceDrop2);

      const allowedAssetZ = await bucket.allowedAssets(testTokenZ.address);
      expect(allowedAssetZ.index).to.equal(3);
      expect(allowedAssetZ.isSupported).to.equal(true);
      expect(await priceOracle.pairPriceDrops(testTokenZ.address, testTokenA.address)).to.equal(pairPriceDrop3);
    });

    it("removeAsset should correct update state", async function () {
      // asset id=0 is testTokenB
      // add extra assets
      const pairPriceDrop1 = parseEther("0.01");
      const pairPriceDrop2 = pairPriceDrop1.mul(2);
      const pairPriceDrop3 = pairPriceDrop2.mul(2);

      await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop1);
      await priceOracle.setPairPriceDrop(testTokenY.address, testTokenA.address, pairPriceDrop2);
      await priceOracle.setPairPriceDrop(testTokenZ.address, testTokenA.address, pairPriceDrop3);

      await bucket.addAsset(testTokenX.address);
      await bucket.addAsset(testTokenY.address);
      await bucket.addAsset(testTokenZ.address);
      expect((await bucket.getAllowedAssets()).length).to.equal(4); // 3 + initially assets(now 1)

      const allowedAssetB = await bucket.allowedAssets(testTokenB.address);
      let allowedAssetX = await bucket.allowedAssets(testTokenX.address);
      const allowedAssetY = await bucket.allowedAssets(testTokenY.address);
      let allowedAssetZ = await bucket.allowedAssets(testTokenZ.address);

      await bucket.connect(SmallTimelockAdmin).removeAsset(testTokenX.address, { gasLimit: 2000000 });
      expect((await bucket.getAllowedAssets()).length).to.equal(3);

      allowedAssetZ = {
        index: allowedAssetX.index,
        isSupported: allowedAssetZ.isSupported,
      };

      allowedAssetX = {
        index: 0,
        isSupported: false,
      };
      parseArguments(allowedAssetB, await bucket.allowedAssets(testTokenB.address));
      parseArguments(allowedAssetZ, await bucket.allowedAssets(testTokenZ.address));
      parseArguments(allowedAssetY, await bucket.allowedAssets(testTokenY.address));
      parseArguments(allowedAssetX, await bucket.allowedAssets(testTokenX.address));

      parseArguments([testTokenB.address, testTokenZ.address, testTokenY.address], await bucket.getAllowedAssets());
    });

    it("removeAsset should revert when asset isn't supported", async function () {
      await expect(bucket.removeAsset(testTokenX.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_IS_NOT_SUPPORTED");
    });

    it("removeAsset should create event", async function () {
      await expect(bucket.removeAsset(testTokenB.address)).to.emit(bucket, "RemoveAsset").withArgs(testTokenB.address);
    });

    it("addAsset should create event", async function () {
      const pairPriceDrop1 = parseEther("0.01");
      await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop1);
      await expect(bucket.addAsset(testTokenX.address)).to.emit(bucket, "AddAsset").withArgs(testTokenX.address);
    });

    it("Should not allow to add duplicate token to allowed for deals token list", async function () {
      await expect(bucket.addAsset(testTokenB.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_ALREADY_SUPPORTED");

      const assets = await bucket.getAllowedAssets();
      expect(assets.length).to.equal(1);
      expect(assets[0]).to.be.equal(testTokenB.address);
    });

    it("Should not allow to add token with incorrect decimals ", async function () {
      await run("deploy:ERC20Mock", {
        name: "TestToken",
        symbol: "TT",
        decimals: "19", // wrong decimals
      });
      const testToken = await getContract("TestToken");
      await expect(bucket.addAsset(testToken.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_DECIMALS_EXCEEDS_MAX_VALUE");
    });

    // todo: add test for checking adding asset with decimals = 18
  });

  describe("Fee collection", function () {
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
    it("Should mint correct amount of token to the reserve for Utilization Ratio 5%", async function () {
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender).deposit(lender.address, deposit);
      const borrow = parseUnits("5", decimalsA);
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: calculateFee(deposit, borrow) },
      );
      const BAR = await bucket.bar();
      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const LAR = await bucket.lar();
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const newBorrowedIndex = rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString());
      const newDebt = rayMul(borrow.toString(), newBorrowedIndex);
      const lastDebt = rayMul(borrow.toString(), RAY);
      const secondDeposit = parseUnits("50", decimalsA);
      await bucket.connect(lender).deposit(lender.address, secondDeposit);
      const liquidityRate = calculateLinearInterest(LAR.toString(), lastUpdBlockTimestamp, txBlockTimestamp);
      const debtAccrued = wadMul(newDebt.minus(lastDebt).toString(), reserveRate);
      const toMint = rayDiv(debtAccrued, liquidityRate);
      expect(await pTestTokenA.scaledBalanceOf(reserve.address)).to.equal(toMint.toString());
    });

    it("Should mint correct amount of token to the reserve for Utilization Ratio 30%", async function () {
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender).deposit(lender.address, deposit);

      const borrow = parseUnits("30", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: calculateFee(deposit, borrow) },
      );
      const BAR = await bucket.bar();
      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const LAR = await bucket.lar();
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const newBorrowedIndex = rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString());
      const newDebt = rayMul(borrow.toString(), newBorrowedIndex);
      const lastDebt = rayMul(borrow.toString(), RAY);
      const secondDeposit = parseUnits("50", decimalsA);
      await bucket.connect(lender).deposit(lender.address, secondDeposit);
      const liquidityRate = calculateLinearInterest(LAR.toString(), lastUpdBlockTimestamp, txBlockTimestamp);
      const debtAccrued = wadMul(newDebt.minus(lastDebt).toString(), reserveRate);
      const toMint = rayDiv(debtAccrued, liquidityRate);

      expect(await pTestTokenA.scaledBalanceOf(reserve.address)).to.equal(toMint.toString());
    });

    it("Should mint correct amount of token to the reserve for Utilization Ratio 70%", async function () {
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender).deposit(lender.address, deposit);

      const borrow = parseUnits("70", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: calculateFee(deposit, borrow) },
      );
      const BAR = await bucket.bar();
      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const LAR = await bucket.lar();
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const newBorrowedIndex = rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString());
      const newDebt = rayMul(borrow.toString(), newBorrowedIndex);
      const lastDebt = rayMul(borrow.toString(), RAY);
      const secondDeposit = parseUnits("50", decimalsA);
      await bucket.connect(lender).deposit(lender.address, secondDeposit);
      const liquidityRate = calculateLinearInterest(LAR.toString(), lastUpdBlockTimestamp, txBlockTimestamp);
      const debtAccrued = wadMul(newDebt.minus(lastDebt).toString(), reserveRate);
      const toMint = rayDiv(debtAccrued, liquidityRate);
      expect(await pTestTokenA.scaledBalanceOf(reserve.address)).to.equal(toMint.toString());
    });

    // todo: add tests for Utilization Ratio 0(minimal valid value) and 100

    it("Should return correct balances of ptoken which sum is less or equal to availableLiquidity", async function () {
      const numberOfDeposits = 15;
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender).deposit(lender.address, deposit);
      const borrow = parseUnits("20", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const swapSize = depositAmount.add(borrow);
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = amountBOut.mul(multiplierB);

      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const swap = swapSize.mul(multiplierA);

      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: calculateFee(deposit, borrow) },
      );
      // If the number of cycles increases,
      // the amount of P-tokens may exceed the availableLiquidity of the bucket.
      // This is due to the _mintToReserve function and a feature of the WadRayMath library
      // that rounds the resulting value to the nearest integer.
      // As a result, after a large number of mints there may be a gap between P-tokens and available liquidity in the bucket.
      // But we do not consider this as a bug for the following reasons:
      // 1. The gap size is very small and in market conditions, it may be absent (different values of the mint will give rounding with equal probability)
      // 2. The issue may appear only in the case of a bank run
      // 3. The issue can be easily solved by sending the missing amount of borrowed asset to the bucket address

      const timestamp = (await provider.getBlock("latest")).timestamp + 1;
      for (let i = 0; i < numberOfDeposits; i++) {
        await network.provider.send("evm_setNextBlockTimestamp", [timestamp + i]);
        // to upd rates
        await bucket.connect(lender).deposit(lender.address, parseUnits("1", decimalsA));
      }

      await positionManager
        .connect(trader)
        .closePosition(0, trader.address, await getSingleRoute([testTokenB.address, testTokenA.address], dex), 0);
      const pTokenSum = (await pTestTokenA.balanceOf(lender.address)).add(await pTestTokenA.balanceOf(reserve.address));
      expect(pTokenSum).to.be.closeTo(await bucket.availableLiquidity(), numberOfDeposits);
    });

    it("Should return correct balances of ptoken which sum is less than availableLiquidity when updating indexes and rates isn't called", async function () {
      const deposit = parseUnits("100", decimalsA);
      await bucket.connect(lender).deposit(lender.address, deposit);
      const borrow = parseUnits("20", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, deposit);

      const swapSize = depositAmount.add(borrow);
      const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = amountBOut.mul(multiplierB);

      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const swap = swapSize.mul(multiplierA);

      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: calculateFee(deposit, borrow) },
      );
      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }
      await positionManager
        .connect(trader)
        .closePosition(0, trader.address, await getSingleRoute([testTokenB.address, testTokenA.address], dex), 0);
      const pTokenSum = (await pTestTokenA.balanceOf(lender.address)).add(await pTestTokenA.balanceOf(reserve.address));
      expect(pTokenSum.lte(await bucket.availableLiquidity())).to.equal(true);
      const denominator = Math.pow(10, Math.floor(decimalsA / 2));
      const smallSum = 1 / denominator;
      expect(pTokenSum).to.closeTo(await bucket.availableLiquidity(), parseUnits(smallSum.toFixed(decimalsA), decimalsA));
    });
  });

  describe("deposit", function () {
    let mockWhiteBlackList, mockInterestRateStrategy;
    let snapshotId;
    before(async function () {
      mockInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
      mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
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

    it("Should revert deposit if bucket not active in dns", async function () {
      await PrimexDNS.freezeBucket(await bucket.name());
      await expect(bucket.connect(lender).deposit(lender.address, "100")).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_INACTIVE",
      );
    });

    it("Should revert deposit if bucket not added in dns", async function () {
      const nameBucket = "bucket2";
      const assets = [];
      const pairPriceDrops = [];
      await BucketsFactory.createBucket({
        nameBucket: nameBucket,
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        dns: PrimexDNS.address,
        reserve: reserve.address,
        assets: assets,
        whiteBlackList: mockWhiteBlackList.address,
        pairPriceDrops: pairPriceDrops,
        underlyingAsset: testTokenA.address,
        feeBuffer: feeBuffer,
        withdrawalFeeRate: withdrawalFeeRate,
        reserveRate: reserveRate,
        liquidityMiningRewardDistributor: AddressZero,
        liquidityMiningAmount: 0,
        liquidityMiningDeadline: 0,
        stabilizationDuration: 0,
        interestRateStrategy: mockInterestRateStrategy.address,
        maxAmountPerUser: 0,
        isReinvestToAaveEnabled: false,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: barCalcParams,
        maxTotalDeposit: MaxUint256.toString(),
      });

      const bucket2 = await getContractAt("Bucket", await BucketsFactory.buckets(1));
      await testTokenA.connect(lender).approve(bucket2.address, "100");
      await expect(bucket2.connect(lender).deposit(lender.address, "100")).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_NOT_ADDED");
    });

    it("Should revert deposit if bucket not in primex protocol", async function () {
      const nameBucket = "bucket1";
      const assets = [];
      const pairPriceDrops = [];
      await BucketsFactory.createBucket({
        nameBucket: nameBucket,
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        dns: PrimexDNS.address,
        reserve: reserve.address,
        whiteBlackList: mockWhiteBlackList.address,
        assets: assets,
        pairPriceDrops: pairPriceDrops,
        underlyingAsset: testTokenA.address,
        feeBuffer: feeBuffer,
        withdrawalFeeRate: withdrawalFeeRate,
        reserveRate: reserveRate,
        liquidityMiningRewardDistributor: AddressZero,
        liquidityMiningAmount: 0,
        liquidityMiningDeadline: 0,
        stabilizationDuration: 0,
        interestRateStrategy: mockInterestRateStrategy.address,
        maxAmountPerUser: 0,
        isReinvestToAaveEnabled: false,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: barCalcParams,
        maxTotalDeposit: MaxUint256.toString(),
      });
      const bucket2 = await getContractAt("Bucket", await BucketsFactory.buckets(1));
      await testTokenA.connect(lender).approve(bucket2.address, "100");

      await expect(bucket2.connect(lender).deposit(lender.address, "100")).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_OUTSIDE_PRIMEX_PROTOCOL",
      );
    });

    it("Should revert deposit if user has not approved tokens", async function () {
      const deposit = parseUnits("100", decimalsA);
      await expect(bucket.connect(caller).deposit(caller.address, deposit)).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("Should emit RatesIndexesUpdated when deposit into a launched bucket", async function () {
      const amount = parseUnits("0.001", decimalsA);
      await testTokenA.mint(deployer.address, amount);
      await testTokenA.connect(deployer).approve(bucket.address, amount);
      const tx = await bucket.deposit(deployer.address, amount);

      const bar = await bucket.bar();
      const lar = await bucket.lar();
      const variableBorrowIndex = await bucket.variableBorrowIndex();
      const liquidityIndex = await bucket.liquidityIndex();
      await expect(tx)
        .to.emit(bucket, "RatesIndexesUpdated")
        .withArgs(bar, lar, variableBorrowIndex, liquidityIndex, (await provider.getBlock(tx.blockNumber)).timestamp);
    });

    it("Should revert when deposit is more than maxTotalDeposit", async function () {
      const depositAmount = parseEther("8");
      const maxTotalDeposit = depositAmount.sub(1);
      await testTokenA.mint(deployer.address, depositAmount);
      await testTokenA.approve(bucket.address, depositAmount);

      const pTokenSupply = await pTestTokenA.totalSupply();
      expect(pTokenSupply.add(depositAmount)).to.be.gt(maxTotalDeposit);

      await bucket.setMaxTotalDeposit(maxTotalDeposit);
      expect(await bucket.maxTotalDeposit()).to.equal(maxTotalDeposit);

      await expect(bucket.deposit(deployer.address, depositAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEPOSIT_EXCEEDS_MAX_TOTAL_DEPOSIT",
      );
    });

    it("Should deposit when deposit amount is less than maxTotalDeposit", async function () {
      const depositAmount = parseEther("8");
      const maxTotalDeposit = depositAmount.add(1);
      await testTokenA.mint(deployer.address, depositAmount);
      await testTokenA.approve(bucket.address, depositAmount);

      const pTokenSupply = await pTestTokenA.totalSupply();
      expect(pTokenSupply.add(depositAmount)).to.be.lt(maxTotalDeposit);

      await bucket.setMaxTotalDeposit(maxTotalDeposit);
      expect(await bucket.maxTotalDeposit()).to.equal(maxTotalDeposit);

      await expect(bucket.deposit(deployer.address, depositAmount)).to.emit(bucket, "Deposit"); // todo: should check values in event Deposit after deposit
    });

    // todo: should revert if blacklisted user call deposit
    // todo: should deposit when deposit amount is less than maxTotalDeposit and bucket is LM
  });

  describe("paybackPermanentLoss - unit testing", function () {
    let bucketContract;
    let mockPtoken,
      mockDebtToken,
      mockPositionManager,
      mockPriceOracle,
      mockPrimexDns,
      mockReserve,
      mockErc20,
      mockInterestRateStrategy,
      mockWhiteBlackList;
    let deployer, trader, traderBalanceVault;

    before(async function () {
      [deployer, trader, traderBalanceVault] = await getSigners();

      mockPtoken = await deployMockPToken(deployer);
      mockDebtToken = await deployMockDebtToken(deployer);
      mockPositionManager = await deployMockPositionManager(deployer);
      [mockPriceOracle] = await deployMockPriceOracle(deployer);
      mockPrimexDns = await deployMockPrimexDNS(deployer);
      mockReserve = await deployMockReserve(deployer);
      mockErc20 = await deployMockERC20(deployer);

      mockInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
      mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
      mockPtokensFactory = await deployMockPtokensFactory(deployer);
      mockDebtTokensFactory = await deployMockDebtTokensFactory(deployer);
      const bucketImplementation = await getContract("Bucket");
      const bucketsFactoryContractFactory = await getContractFactory("BucketsFactory");
      mockRegistry = await deployMockAccessControl(deployer);

      await mockInterestRateStrategy.mock.calculateInterestRates.returns(1, 1);
      await mockPositionManager.mock.priceOracle.returns(mockPriceOracle.address);
      await mockPriceOracle.mock.pairPriceDrops.withArgs(mockErc20.address, mockErc20.address).returns(One);
      await mockPriceOracle.mock.getPriceFeedsPair
        .withArgs(mockErc20.address, mockErc20.address)
        .returns(mockErc20.address, mockErc20.address);

      await mockPtokensFactory.mock.createPToken.returns(mockPtoken.address);
      await mockDebtTokensFactory.mock.createDebtToken.returns(mockDebtToken.address);

      const bucketsFactory = await bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      );
      await bucketsFactory.deployed();

      const bucketInitParams = {
        nameBucket: "Bucket--PaybackPermanentLoss",
        positionManager: mockPositionManager.address,
        priceOracle: mockPriceOracle.address,
        dns: mockPrimexDns.address,
        reserve: mockReserve.address,
        whiteBlackList: mockWhiteBlackList.address,
        assets: [mockErc20.address],
        underlyingAsset: mockErc20.address,
        feeBuffer: "1000100000000000000",
        withdrawalFeeRate: withdrawalFeeRate.toString(),
        reserveRate: One.toString(),
        liquidityMiningRewardDistributor: AddressZero,
        liquidityMiningAmount: 0,
        liquidityMiningDeadline: 0,
        stabilizationDuration: 0,
        interestRateStrategy: mockInterestRateStrategy.address,
        maxAmountPerUser: 0,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: barCalcParams,
        maxTotalDeposit: MaxUint256,
      };
      const tx = await bucketsFactory.createBucket(bucketInitParams);
      const txReceipt = await tx.wait();
      const bucketAddress = addressFromEvent("BucketCreated", txReceipt);
      bucketContract = await getContractAt("Bucket", bucketAddress);
    });

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
    it("Should revert when the msg.sender is on the blacklist", async function () {
      const permanentLossAmount = 5;
      await mockWhiteBlackList.mock.isBlackListed.returns(true);
      await expect(bucketContract.paybackPermanentLoss(permanentLossAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });

    it("Should revert when amountScaled is equal zero", async function () {
      const permanentLossAmount = 0;
      await expect(bucketContract.paybackPermanentLoss(permanentLossAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "AMOUNT_SCALED_SHOULD_BE_GREATER_THAN_ZERO",
      );
    });

    it("Should pay exact permanent loss value if input amount is greater than permanent loss value", async function () {
      const permanentLossAmount = 5;
      await bucketContract.decreaseTraderDebt(trader.address, One, traderBalanceVault.address, Zero, permanentLossAmount);
      await bucketContract.paybackPermanentLoss(permanentLossAmount + 1);
      expect(await bucketContract.permanentLoss()).to.be.equal(0);
    });

    it("Should subtract amount from permanentLoss", async function () {
      // set permanentLoss
      const permanentLossAmount = 5;
      await bucketContract.decreaseTraderDebt(trader.address, One, traderBalanceVault.address, Zero, permanentLossAmount);
      const permanentLoss = await bucketContract.permanentLoss();

      // set expected result
      const amount = 1;
      const expectedPermanentLoss = permanentLoss.sub(BigNumber.from(amount));

      await bucketContract.paybackPermanentLoss(amount);

      expect(await bucketContract.permanentLoss()).to.equal(expectedPermanentLoss);
    });

    it("Should return correct permanentLossScaled", async function () {
      const permanentLossAmount = 5;
      await bucketContract.decreaseTraderDebt(trader.address, One, traderBalanceVault.address, Zero, permanentLossAmount);
      const liquidityIndex = await bucketContract.liquidityIndex();
      const expectedValue = rayDiv(permanentLossAmount, liquidityIndex.toString());
      expect(await bucketContract.permanentLossScaled()).to.be.equal(expectedValue);
    });
  });

  async function openPosition(testTokenA, traderBalanceVault, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes) {
    const { trader, lender } = await getNamedSigners();
    const lenderAmount = parseUnits("50", decimalsA);
    const depositAmount = parseUnits("20", decimalsA);

    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender).deposit(lender.address, lenderAmount);

    const borrowedAmount = parseUnits("30", decimalsA);
    const amountOutMin = 0;
    const deadline = new Date().getTime() + 600;
    const takeDepositFromWallet = true;
    const payFeeFromWallet = true;
    await testTokenA.connect(trader).approve(positionManager.address, depositAmount);

    const swapSize = depositAmount.add(borrowedAmount);
    const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    const amountB = amountBOut.mul(multiplierB);
    const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    const swap = swapSize.mul(multiplierA);

    const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
    const price = BigNumber.from(limitPrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
    await priceFeed.setAnswer(price);
    await priceFeed.setDecimals(decimalsB);

    await positionManager.connect(trader).openPosition(
      {
        marginParams: {
          bucket: await bucket.name(),
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
        payFeeFromWallet: payFeeFromWallet,
        closeConditions: [],
      },
      { value: calculateFee(depositAmount, borrowedAmount) },
    );

    const positionsId = await positionManager.positionsId();
    return positionsId.sub(1);
  }

  async function closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutes) {
    const { trader } = await getNamedSigners();
    const { positionAmount } = await positionManager.getPosition(positionId);

    const amountAOut = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
    const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    const amountA = amountAOut.mul(multiplierA);

    const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    const posAmount = positionAmount.mul(multiplierB);

    const limitPrice = wadDiv(posAmount.toString(), amountA.toString()).toString();
    const price = BigNumber.from(limitPrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
    await priceFeed.setAnswer(price);

    await positionManager.connect(trader).closePosition(positionId, trader.address, assetRoutes, 0);
  }

  describe("paybackPermanentLoss - integration testing", function () {
    let bucket, bucketAddress;
    let pToken, pTokenAddress;
    let testTokenA, testTokenB;
    let traderBalanceVault;
    let dex;
    let priceFeed, priceOracle;
    let PrimexDNS;
    let positionManager;
    let assetRoutes;
    let assetRoutesForClose;
    let amountIn;

    before(async function () {
      const { trader } = await getNamedSigners();
      amountIn = parseUnits("100", decimalsB).toString();

      testTokenA = await getContract("TestTokenA");
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      testTokenB = await getContract("TestTokenB");

      traderBalanceVault = await getContract("TraderBalanceVault");

      PrimexDNS = await getContract("PrimexDNS");
      positionManager = await getContract("PositionManager");

      bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
      bucket = await getContractAt("Bucket", bucketAddress);

      if (process.env.DEX && process.env.DEX !== "uniswap") {
        dex = process.env.DEX;
      } else {
        dex = "uniswap";
      }

      checkIsDexSupported(dex);
      assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
      assetRoutesForClose = await getSingleRoute([testTokenB.address, testTokenA.address], dex);

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

      priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
      await priceFeed.setDecimals("18");
      priceOracle = await getContract("PriceOracle");
      await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);

      pTokenAddress = await bucket.pToken();
      pToken = await getContractAt("PToken", pTokenAddress);
    });

    it("Should revert if a param 'uint256 amount' > pToken.balanceOf(msg.sender)", async function () {
      const positionId = await openPosition(
        testTokenA,
        traderBalanceVault,
        bucket,
        priceFeed,
        positionManager,
        dex,
        testTokenB,
        assetRoutes,
      );

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amountIn,
        path: [testTokenB.address, testTokenA.address],
      });

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

      const permanentLoss = await bucket.permanentLoss();
      const balance = await pToken.balanceOf(trader.address);
      const amount = BigNumber.from(balance).add(1).mul(2);

      expect(amount).to.be.lt(BigNumber.from(permanentLoss));
      expect(amount).to.be.gt(BigNumber.from(balance));
      await expect(bucket.connect(trader).paybackPermanentLoss(amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );
    });

    it("Should emit Burn event if a param 'uint256 amount' <= pToken.balanceOf(msg.sender)", async function () {
      const positionId = await openPosition(
        testTokenA,
        traderBalanceVault,
        bucket,
        priceFeed,
        positionManager,
        dex,
        testTokenB,
        assetRoutes,
      );

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

      const permanentLoss = await bucket.permanentLoss();

      await bucket.connect(lender).deposit(lender.address, parseUnits("2", decimalsA));
      const balance = await pToken.balanceOf(lender.address);

      const amount = balance.gt(permanentLoss) ? balance.mod(permanentLoss) : balance;

      expect(amount).to.be.lt(BigNumber.from(permanentLoss));
      expect(amount).to.be.lte(BigNumber.from(balance));
      await expect(bucket.connect(lender).paybackPermanentLoss(amount)).to.emit(pToken, "Burn").withArgs(lender.address, amount);
    });

    it("Should increase debt over time", async function () {
      const positionId = await openPosition(
        testTokenA,
        traderBalanceVault,
        bucket,
        priceFeed,
        positionManager,
        dex,
        testTokenB,
        assetRoutes,
      );

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

      const permanentLossBefore = await bucket.permanentLoss();
      const liquidityIndexBefore = await bucket.liquidityIndex();
      await network.provider.send("evm_increaseTime", [60 * 60 * 24]);
      await bucket.connect(lender).deposit(lender.address, parseUnits("2", decimalsA));
      const liquidityIndexAfter = await bucket.liquidityIndex();
      const expectedDebt = rayMul(
        rayDiv(permanentLossBefore.toString(), liquidityIndexBefore.toString()).toString(),
        liquidityIndexAfter.toString(),
      ).toString();
      expect(await bucket.permanentLoss()).to.be.equal(expectedDebt);
    });
  });

  describe("Integration tests deposit liquidity to Aave", function () {
    let snapshotId, snapshotIdBase;
    let pmx, pmxRewardAmount, liquidityMiningDeadline, stabilizationDuration, liquidityMiningAmount, bucket, poolAddress;
    let usdCoin, decimalsUSDC, aaveAToken, treasury;
    before(async function () {
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });

      pmx = await getContract("EPMXToken");
      usdCoin = await getContract("USD Coin");
      decimalsUSDC = await usdCoin.decimals();
      aaveAToken = await getContract("USDC-AToken-Test");
      treasury = await getContract("Treasury");

      const currentTimestamp = (await provider.getBlock("latest")).timestamp + 100;

      await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);

      liquidityMiningDeadline = currentTimestamp + 24 * 60 * 60;
      stabilizationDuration = 60 * 60;
      liquidityMiningAmount = parseUnits("100", decimalsUSDC);
      pmxRewardAmount = parseUnits("100", await pmx.decimals());
      pairPriceDrop = "100000000000000000"; // 0.1 in wad
      await priceOracle.setPairPriceDrop(testTokenB.address, usdCoin.address, pairPriceDrop);
      await priceOracle.updatePriceFeed(usdCoin.address, USD, priceFeed.address);

      const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
        nameBucket: "BucketWithLiquidityMining",
        assets: `["${testTokenB.address}"]`,
        feeBuffer: "1000100000000000000", // 1.0001
        withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
        reserveRate: "100000000000000000", // 0.1 - 10%,
        underlyingAsset: usdCoin.address,
        liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
        liquidityMiningAmount: liquidityMiningAmount.toString(),
        liquidityMiningDeadline: liquidityMiningDeadline.toString(),
        stabilizationDuration: stabilizationDuration.toString(), // 1 hour
        pmxRewardAmount: pmxRewardAmount.toString(),
        maxAmountPerUser: MaxUint256.toString(),
        isReinvestToAaveEnabled: true,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: JSON.stringify(defaultBarCalcParams),
        maxTotalDeposit: MaxUint256.toString(),
      });
      bucket = await getContractAt("Bucket", newBucketAddress);
      pTestTokenA = await getContractAt("PToken", await bucket.pToken());
      const addressesProvider = await getPoolAddressesProvider();
      poolAddress = await addressesProvider.getPool();
      await PrimexDNS.setAavePool(poolAddress);
    });
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
    });

    it("Should deposit to Aave when isReinvestToAaveEnabled = true and emit DepositToAave event", async function () {
      const amount = "10";
      const depositAmount = parseUnits(amount, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount);
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);

      await expect(bucket.connect(lender).deposit(lender.address, depositAmount))
        .to.emit(bucket, "DepositToAave")
        .withArgs(poolAddress, depositAmount);
      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(depositAmount);
      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(0);
    });

    // todo: should revert if aavePool is not in DNS

    it("Should deposit to Aave user tokens together with directly sent tokens", async function () {
      const amount = "10";
      const amount2 = "5";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      const directAmount = parseUnits(amount2, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount.add(directAmount));
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);
      await usdCoin.connect(lender).transfer(bucket.address, directAmount);
      await bucket.connect(lender).deposit(lender.address, depositAmount);

      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(depositAmount.add(directAmount));
      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(0);
    });

    it("Should withdraw from Aave during liquidity mining and emit withdrawFromAave event", async function () {
      const amount = "10";
      const amount2 = "5";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      const amountToWithdraw = parseUnits(amount2, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount);
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);
      await bucket.connect(lender).deposit(lender.address, depositAmount);

      const balanceInAaveBefore = await aaveAToken.balanceOf(bucket.address);
      const lenderBalanceBefore = await usdCoin.balanceOf(lender.address);
      const treasuryBalanceBefore = await usdCoin.balanceOf(treasury.address);

      await expect(bucket.connect(lender).withdraw(lender.address, amountToWithdraw))
        .to.emit(bucket, "WithdrawFromAave")
        .withArgs(poolAddress, amountToWithdraw);

      const lenderBalanceAfter = await usdCoin.balanceOf(lender.address);
      const treasuryBalanceAfter = await usdCoin.balanceOf(treasury.address);
      const actualAmountTransferredToLender = lenderBalanceAfter.sub(lenderBalanceBefore);
      const actualAmountTransferredToTreasury = treasuryBalanceAfter.sub(treasuryBalanceBefore);
      const particleToLender = BigNumber.from(WAD).sub(BigNumber.from(withdrawalFeeRate));
      const expectedAmountTransferredToLender = BigNumber.from(wadMul(particleToLender.toString(), amountToWithdraw.toString()).toString());
      const expectedAmountTransferredToTreasury = amountToWithdraw.sub(expectedAmountTransferredToLender);

      expect(actualAmountTransferredToLender).to.equal(expectedAmountTransferredToLender);
      expect(actualAmountTransferredToTreasury).to.equal(expectedAmountTransferredToTreasury);
      expect(actualAmountTransferredToLender.add(actualAmountTransferredToTreasury)).to.equal(amountToWithdraw);
      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(0);
      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(balanceInAaveBefore.sub(amountToWithdraw));
    });

    it("Should withdraw from Aave during liquidity mining using _amount is magic number(MaxUint256)", async function () {
      const amount = "10";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      await usdCoin.mint(lender.address, depositAmount);
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);
      await bucket.connect(lender).deposit(lender.address, depositAmount);
      await bucket.connect(lender).withdraw(lender.address, MaxUint256);
    });

    it("Should withdraw all liquidity from Aave when liquidity mining is failed", async function () {
      const amount = "10";
      const amount2 = "5";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      const withdrawAmount = parseUnits(amount2, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount);
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);
      await bucket.connect(lender).deposit(lender.address, depositAmount);
      await network.provider.send("evm_setNextBlockTimestamp", [liquidityMiningDeadline + 1]);
      await bucket.connect(lender).withdraw(lender.address, withdrawAmount);

      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(depositAmount.sub(withdrawAmount));
      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(0);
    });

    // todo: Should withdraw all liquidity from Aave when bucket with aaveDeposit is deprecated

    it("Should withdraw all liquidity from Aave when liquidity mining is failed and user depositFromBucket", async function () {
      const bucketSameName = "The same underlyingAsset";
      await run("deploy:Bucket", {
        nameBucket: bucketSameName,
        assets: `["${testTokenB.address}"]`,
        pairPriceDrops: "[\"100000000000000000\"]",
        feeBuffer: "1000100000000000000", // 1.0001
        withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
        reserveRate: "100000000000000000", // 0.1 - 10%,
        underlyingAsset: usdCoin.address,
        liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
        liquidityMiningAmount: liquidityMiningAmount.toString(),
        liquidityMiningDeadline: (liquidityMiningDeadline + 1000).toString(),
        maxAmountPerUser: MaxUint256.toString(),
        stabilizationDuration: stabilizationDuration.toString(), // 1 hour
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        pmxRewardAmount: pmxRewardAmount.toString(),
        barCalcParams: JSON.stringify(defaultBarCalcParams),
        maxTotalDeposit: MaxUint256.toString(),
      });

      const swapManager = await getContract("SwapManager");
      const amount = "10";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      const depositAmount2 = depositAmount.mul(2);

      await usdCoin.mint(lender.address, depositAmount);
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);
      await bucket.connect(lender).deposit(lender.address, depositAmount);

      await usdCoin.mint(deployer.address, depositAmount2);
      await usdCoin.approve(bucket.address, depositAmount2);
      await bucket.deposit(deployer.address, depositAmount2);

      await network.provider.send("evm_setNextBlockTimestamp", [liquidityMiningDeadline + 1]);
      await bucket.connect(lender).depositFromBucket(bucketSameName, swapManager.address, [], 0);

      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(depositAmount2);
      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(0);
    });

    it("Should withdraw all liquidity from Aave when bucket is launched", async function () {
      const amount = "90";
      const amount2 = "11";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      const secondDepositAmount = parseUnits(amount2, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount.add(secondDepositAmount));
      await usdCoin.connect(lender).approve(bucket.address, depositAmount.add(secondDepositAmount));
      await bucket.connect(lender).deposit(lender.address, depositAmount);
      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(depositAmount);
      // make second deposit to launch the bucket
      await bucket.connect(lender).deposit(lender.address, secondDepositAmount);

      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(0);
      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(depositAmount.add(secondDepositAmount));
    });

    it("Should transfer earned interest to treasury when bucket is launched and emit TopUpTreasury event", async function () {
      const amount = "90";
      const amount2 = "11";
      const depositAmount = parseUnits(amount, decimalsUSDC);
      const secondDepositAmount = parseUnits(amount2, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount.add(secondDepositAmount));
      await usdCoin.connect(lender).approve(bucket.address, depositAmount.add(secondDepositAmount));
      await bucket.connect(lender).deposit(lender.address, depositAmount);
      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(depositAmount);

      // borrow some funds from aave to create interest for lender
      const AavePool = await getContractAt("Pool", poolAddress);
      const weth = await getContract("Wrapped Ether");
      const collateralAmount = parseUnits("100", await weth.decimals());
      await weth.approve(poolAddress, collateralAmount);
      await AavePool.supply(weth.address, collateralAmount, deployer.address, 0);
      const borrowAmount = parseUnits("10", decimalsUSDC);
      await AavePool.borrow(usdCoin.address, borrowAmount, 1, 0, deployer.address);

      await network.provider.send("evm_setNextBlockTimestamp", [liquidityMiningDeadline - 100]);
      await usdCoin.approve(poolAddress, MaxUint256);
      await AavePool.repay(usdCoin.address, borrowAmount.mul(2), 1, deployer.address);

      const earnedInterest = (await aaveAToken.balanceOf(bucket.address)).sub(depositAmount);
      // make second deposit to launch the bucket
      await expect(bucket.connect(lender).deposit(lender.address, secondDepositAmount))
        .to.emit(bucket, "TopUpTreasury")
        .withArgs(poolAddress, earnedInterest);
      expect(await usdCoin.balanceOf(bucket.address)).to.be.equal(depositAmount.add(secondDepositAmount));
      expect(await usdCoin.balanceOf(treasury.address)).to.be.equal(earnedInterest);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call returnLiquidityFromAaveToBucket", async function () {
      await expect(bucket.connect(caller).returnLiquidityFromAaveToBucket()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should returnLiquidityFromAaveToBucket when tokens left in Aave pool", async function () {
      const amount = "10";
      const depositAmount = parseUnits(amount, decimalsUSDC);

      await usdCoin.mint(lender.address, depositAmount);
      await usdCoin.connect(lender).approve(bucket.address, depositAmount);
      await bucket.connect(lender).deposit(lender.address, depositAmount);

      await expect(() => bucket.connect(SmallTimelockAdmin).returnLiquidityFromAaveToBucket()).to.changeTokenBalance(
        usdCoin,
        bucket,
        depositAmount,
      );

      expect(await aaveAToken.balanceOf(bucket.address)).to.be.equal(0);
      expect(await bucket.isReinvestToAaveEnabled()).to.be.equal(false);
    });
  });
  describe("withdraw", function () {
    it("Should revert while attempt to withdraw more than there is liquidity in the bucket", async function () {
      const deposit = parseUnits("100", decimalsA);
      const borrow = parseUnits("20", decimalsA);
      await testTokenA.connect(lender).approve(bucket.address, deposit);
      await bucket.connect(lender).deposit(lender.address, deposit);
      await testTokenA.mint(trader.address, deposit);
      await testTokenA.connect(trader).approve(positionManager.address, deposit);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const swapSize = deposit.add(borrow);

      const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = amountBOut.mul(multiplierB);

      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const swap = swapSize.mul(multiplierA);

      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
      await priceFeed.setAnswer(price);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
          depositAsset: testTokenA.address,
          depositAmount: deposit,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: calculateFee(deposit, borrow) },
      );
      const pTestTokenAddress = await bucket.pToken();
      const pTestTokenA = await getContractAt("PToken", pTestTokenAddress);
      const pTokenBalance = await pTestTokenA.balanceOf(lender.address);
      await expect(bucket.connect(lender).withdraw(lender.address, pTokenBalance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NOT_ENOUGH_LIQUIDITY_IN_THE_BUCKET",
      );
    });
  });
});
// todo: add tests for nonReentrant
// todo: replace callers to deployer who doesnt have the ckecked role
