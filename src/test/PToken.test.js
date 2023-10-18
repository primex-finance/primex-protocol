// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContractFactory,
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseUnits, defaultAbiCoder },
    constants: { MaxUint256, NegativeOne, AddressZero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const { BigNumber: BN } = require("bignumber.js");
const { addLiquidity, checkIsDexSupported, getSingleRoute } = require("./utils/dexOperations");
const { getImpersonateSigner, getAdminSigners } = require("./utils/hardhatUtils");
const { addressFromEvent } = require("./utils/addressFromEvent");

const { RAY, WAD, OrderType, NATIVE_CURRENCY, BAR_CALC_PARAMS_DECODE, MAX_TOKEN_DECIMALITY } = require("./utils/constants");
const { rayMul, rayDiv, wadMul, calculateBar } = require("./utils/math");
const {
  deployMockReserve,
  deployMockBucketsFactory,
  deployMockBucket,
  deployBonusExecutor,
  deployLMRewardDistributor,
} = require("./utils/waffleMocks");
const { parseArguments, eventValidation } = require("./utils/eventValidation");
const { parseEther } = require("ethers/lib/utils");
const { barCalcParams } = require("./utils/defaultBarCalcParams");

const secondsPerYear = new BN("31536000");
const feeBuffer = "1000200000000000000"; // 1.0002
const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
const reserveRate = "100000000000000000"; // 0.1 - 10%
const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

process.env.TEST = true;

describe("Ptoken", function () {
  let pTestTokenA, decimalsPToken, testTokenA, decimalsA, bucket, lender, lender2, recipient, trader, dex, deployer, mockContract;
  let positionManager, priceOracle, PrimexDNS, interestRateStrategy, whiteBlackList;
  let snapshotIdBase;
  let mockBucket, mockExecutor, mockReserve;
  let tokenTransfersLibrary;
  let assetShares;
  let ErrorsLibrary;
  let PriceInETH, protocolRate;
  let BigTimelockAdmin;
  let registry, mockBucketsFactorySigner, mockBucketsFactory, pTokensFactory;
  let multiplierA;

  before(async function () {
    await fixture(["Test"]);
    ({ lender, lender2, recipient, trader, deployer } = await getNamedSigners());
    ({ BigTimelockAdmin } = await getAdminSigners());
    mockBucketsFactory = await deployMockBucketsFactory(deployer);
    mockBucketsFactorySigner = await getImpersonateSigner(mockBucketsFactory);
    registry = await getContract("Registry");
    const pTokensFactoryFactory = await getContractFactory("PTokensFactory");
    const pTokenImplementation = await getContract("PToken");
    pTokensFactory = await pTokensFactoryFactory.deploy(pTokenImplementation.address, registry.address);
    await pTokensFactory.deployed();
    await pTokensFactory.setBucketsFactory(mockBucketsFactory.address);

    testTokenA = await getContract("TestTokenA");
    ErrorsLibrary = await getContract("Errors");
    decimalsA = await testTokenA.decimals();
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    const testTokenB = await getContract("TestTokenB");

    PrimexDNS = await getContract("PrimexDNS");
    whiteBlackList = await getContract("WhiteBlackList");
    mockContract = await getImpersonateSigner(PrimexDNS);
    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    const pTestTokenAddress = await bucket.pToken();
    pTestTokenA = await getContractAt("PToken", pTestTokenAddress);
    decimalsPToken = await pTestTokenA.decimals();

    dex = process.env.DEX || "uniswap";
    checkIsDexSupported(dex);
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    interestRateStrategy = await getContract("InterestRateStrategy");
    protocolRate = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY);

    const priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(PriceInETH);
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    // a stub so that the tests do not fail.
    // this is acceptable because in these tests the PToken is checked
    // and it is important in it that the position has opened and not the conditions for its opening
    await priceFeed.setAnswer(1);
    await priceFeed.setDecimals(18);

    assetShares = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

    mockBucket = await deployMockBucket(deployer);
    mockExecutor = await deployBonusExecutor(deployer);
    mockReserve = await deployMockReserve(deployer);
    mockExecutor.mock["updateBonus(address,uint256,address,uint256)"].returns();
    mockExecutor.mock["updateBonuses(address[],uint256[],address,uint256)"].returns();
    mockExecutor.mock.updateBonuses.returns();
    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("initialization", function () {
    it("Should initialize with correct values.", async function () {
      expect(await pTestTokenA.name()).to.equal("Primex pToken TestTokenA");
      expect(await pTestTokenA.symbol()).to.equal("P-TTA");
      expect(await pTestTokenA.decimals()).to.equal(decimalsA);

      // correct decimals PToken and DebtToken with deploy bucket with different underlying asset
      const BucketsFactory = await getContract("BucketsFactory");
      const test8 = await run("deploy:ERC20Mock", {
        name: "test8",
        symbol: "T8",
        decimals: "8",
      });
      const test6 = await run("deploy:ERC20Mock", {
        name: "test6",
        symbol: "T6",
        decimals: "6",
      });
      await BucketsFactory.createBucket({
        nameBucket: "bucket2",
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        dns: PrimexDNS.address,
        reserve: mockReserve.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: [],
        pairPriceDrops: [],
        whiteBlackList: whiteBlackList.address,
        underlyingAsset: test8.address,
        feeBuffer: feeBuffer,
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
      await BucketsFactory.createBucket({
        nameBucket: "bucket3",
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        dns: PrimexDNS.address,
        reserve: mockReserve.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: [],
        pairPriceDrops: [],
        whiteBlackList: whiteBlackList.address,
        underlyingAsset: test6.address,
        feeBuffer: feeBuffer,
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
      const buckets = await BucketsFactory.allBuckets();
      const bucket2 = await getContractAt("Bucket", buckets[buckets.length - 2]);
      const bucket3 = await getContractAt("Bucket", buckets[buckets.length - 1]);
      const pTest8 = await getContractAt("PToken", await bucket2.pToken());
      const pTest6 = await getContractAt("PToken", await bucket3.pToken());
      const DebtTest8 = await getContractAt("DebtToken", await bucket2.debtToken());
      const DebtTest6 = await getContractAt("DebtToken", await bucket3.debtToken());
      expect(await pTest8.decimals()).to.equal(8);
      expect(await pTest6.decimals()).to.equal(6);
      expect(await DebtTest8.decimals()).to.equal(8);
      expect(await DebtTest6.decimals()).to.equal(6);
    });
  });

  describe("setBucket", function () {
    it("Should setBucket", async function () {
      const pTokensFactoryFactory = await getContractFactory("PTokensFactory");
      const pTokenImplementation = await getContract("PToken");
      const pTokensFactory = await pTokensFactoryFactory.deploy(pTokenImplementation.address, registry.address);
      await pTokensFactory.deployed();
      await pTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      const pToken = await getContractAt("PToken", pTokenAddress);
      expect(await pToken.connect(mockBucketsFactorySigner).setBucket(mockBucket.address));
    });

    it("Should revert when bucket already set", async function () {
      const pTokensFactory = await getContract("PTokensFactory");
      const bucketsFactory = await pTokensFactory.bucketsFactory();
      const bucketsFactorySigner = await getImpersonateSigner(await getContractAt("BucketsFactory", bucketsFactory));

      await expect(pTestTokenA.connect(bucketsFactorySigner).setBucket(bucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_IMMUTABLE",
      );
    });
    it("Should revert if not the bucket factory call setBucket", async function () {
      const pTokensFactoryFactory = await getContractFactory("PTokensFactory");
      const pTokenImplementation = await getContract("PToken");
      const pTokensFactory = await pTokensFactoryFactory.deploy(pTokenImplementation.address, registry.address);
      await pTokensFactory.deployed();
      await pTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      const pToken = await getContractAt("PToken", pTokenAddress);
      await expect(pToken.setBucket(mockBucket.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert when a param 'IBucket _bucket' does not support IBucket", async function () {
      await mockBucket.mock.supportsInterface.returns(false);

      const pTokensFactoryFactory = await getContractFactory("PTokensFactory");
      const pTokenImplementation = await getContract("PToken");
      const pTokensFactory = await pTokensFactoryFactory.deploy(pTokenImplementation.address, registry.address);
      await pTokensFactory.deployed();
      await pTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      const pToken = await getContractAt("PToken", pTokenAddress);
      await expect(pToken.connect(mockBucketsFactorySigner).setBucket(mockBucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("setInterestIncreaser", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setInterestIncreaser", async function () {
      await expect(pTestTokenA.connect(trader).setInterestIncreaser(bucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert when the address does not support IBonusExecutor", async function () {
      await expect(pTestTokenA.setInterestIncreaser(bucket.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should set the InterestIncreaser", async function () {
      await mockExecutor.mock.supportsInterface.returns(true);
      await pTestTokenA.connect(BigTimelockAdmin).setInterestIncreaser(mockExecutor.address);
      expect(await pTestTokenA.interestIncreaser()).to.be.equal(mockExecutor.address);
    });
    it("Should set zero address", async function () {
      await pTestTokenA.setInterestIncreaser(AddressZero);
      expect(await pTestTokenA.interestIncreaser()).to.be.equal(AddressZero);
    });
  });

  describe("setLenderRewardDistributor", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setLenderRewardDistributor", async function () {
      const newLenderRewardDistributor = trader.address;
      await expect(pTestTokenA.connect(trader).setLenderRewardDistributor(newLenderRewardDistributor)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert when the address does not support IBonusExecutor", async function () {
      await expect(pTestTokenA.setLenderRewardDistributor(bucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should set the LenderRewardDistributor", async function () {
      await mockExecutor.mock.supportsInterface.returns(true);
      const newLenderRewardDistributor = mockExecutor.address;
      await pTestTokenA.connect(BigTimelockAdmin).setLenderRewardDistributor(newLenderRewardDistributor);
      expect(await pTestTokenA.lenderRewardDistributor()).to.be.equal(newLenderRewardDistributor);
    });
    it("Should set zero address", async function () {
      await pTestTokenA.setLenderRewardDistributor(AddressZero);
      expect(await pTestTokenA.lenderRewardDistributor()).to.be.equal(AddressZero);
    });
  });

  describe("MintToReserve", function () {
    let pToken, bucketSigner, normalizedIncome;
    before(async function () {
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      pToken = await getContractAt("PToken", pTokenAddress);

      mockBucket = await deployMockBucket(deployer);
      await pToken.connect(mockBucketsFactorySigner).setBucket(mockBucket.address);
      bucketSigner = await getImpersonateSigner(mockBucket);
      normalizedIncome = RAY.toString();
      await mockBucket.mock.getNormalizedIncome.returns(normalizedIncome);
    });

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
    it("Should only allow the bucket to mint tokens", async function () {
      await expect(pToken.mintToReserve(mockReserve.address, 0, 1)).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_BUCKET");
    });
    it("Should return when the amountScaled is equal to zero", async function () {
      await pToken.connect(bucketSigner).mintToReserve(mockReserve.address, 0, 1); // to get the amountScaled equal to 0
      expect(await pToken.totalSupply()).to.equal(0);
    });
    it("Should mintToReserve", async function () {
      const amount = parseEther("0.1");
      await expect(pToken.connect(bucketSigner).mintToReserve(mockReserve.address, amount, normalizedIncome))
        .to.emit(pToken, "Mint")
        .withArgs(mockReserve.address, amount);
      expect(await pToken.totalSupply()).to.equal(rayDiv(amount.toString(), normalizedIncome).toString());
    });
  });
  describe("Mint & Burn", function () {
    let pToken, bucketMock;
    before(async function () {
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      pToken = await getContractAt("PToken", pTokenAddress);

      const bucketMockFactory = await getContractFactory("BucketMock");
      bucketMock = await bucketMockFactory.deploy();
      await bucketMock.deployed();

      await pToken.connect(mockBucketsFactorySigner).setBucket(bucketMock.address);
      await bucketMock.setPToken(pToken.address);
      await bucketMock.setWhiteBlackList(whiteBlackList.address);
    });

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

    it("Should Mint", async function () {
      const traderPTokenBalance = await pToken.balanceOf(trader.address);
      const amountToMint = parseUnits("1", decimalsPToken);
      const liquidityIndex = await bucketMock.liquidityIndex();
      await bucketMock.mintPToken(trader.address, amountToMint, liquidityIndex);
      const result = traderPTokenBalance.add(rayDiv(amountToMint.toString(), liquidityIndex.toString()).toString());
      expect(await pToken.scaledBalanceOf(trader.address)).to.be.equal(result);
    });

    it("Should revert Mint when a param 'address _user' is zero", async function () {
      await expect(bucketMock.mintPToken(AddressZero, parseUnits("1", decimalsPToken), RAY.toString())).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert Mint when amount is 0", async function () {
      await expect(bucketMock.mintPToken(trader.address, 0, RAY.toString())).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });

    it("Should revert Mint when invalid mint amount", async function () {
      const liquidityIndex = new BN(10).exponentiatedBy(28).toFixed();
      await bucketMock.setLiquidityIndex(liquidityIndex);
      await expect(bucketMock.mintPToken(trader.address, 1, liquidityIndex)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_MINT_AMOUNT",
      );
    });

    it("Should Burn", async function () {
      const traderPTokenBalance = await pToken.balanceOf(trader.address);

      const amountToMint = parseUnits("1", decimalsPToken);
      const liquidityIndex = await bucketMock.liquidityIndex();
      await bucketMock.mintPToken(trader.address, amountToMint, liquidityIndex);
      const result = traderPTokenBalance.add(rayDiv(amountToMint.toString(), liquidityIndex.toString()).toString());

      expect(await pToken.scaledBalanceOf(trader.address)).to.be.equal(result);
      await bucketMock.burnPToken(trader.address, amountToMint, liquidityIndex);
      expect(await pToken.scaledBalanceOf(trader.address)).to.be.equal(traderPTokenBalance);
    });

    it("Should revert Burn when a param 'address _user' is zero", async function () {
      await expect(bucketMock.burnPToken(AddressZero, parseUnits("1", decimalsPToken), RAY.toString())).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert Burn when invalid mint amount", async function () {
      const amountToMint = parseUnits("1", decimalsPToken);
      const liquidityIndex = new BN(10).exponentiatedBy(28).toFixed();
      await bucketMock.setLiquidityIndex(liquidityIndex);
      await bucketMock.mintPToken(trader.address, amountToMint, liquidityIndex);
      await expect(bucketMock.burnPToken(trader.address, 1, liquidityIndex)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_AMOUNT");
    });

    it("Should revert transfer() when invalid transfer amount", async function () {
      const amountToMint = parseUnits("1", decimalsPToken);

      const normalizedIncome = new BN(10).exponentiatedBy(28).toFixed();
      await bucketMock.setNormalizedIncome(normalizedIncome);
      await bucketMock.mintPToken(deployer.address, amountToMint, normalizedIncome);
      await expect(pToken.transfer(recipient.address, 1)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_AMOUNT");
    });

    it("Should revert transferFrom() when invalid transfer amount", async function () {
      const amountToMint = parseUnits("1", decimalsPToken);

      const normalizedIncome = new BN(10).exponentiatedBy(28).toFixed();
      await bucketMock.setNormalizedIncome(normalizedIncome);
      await bucketMock.mintPToken(lender.address, amountToMint, normalizedIncome);
      await pToken.connect(lender).approve(recipient.address, 1);
      await expect(pToken.connect(recipient).transferFrom(lender.address, recipient.address, 1)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_AMOUNT",
      );
    });
  });

  describe("Fixed-term deposits", function () {
    let pToken, bucketMock, amountToMint, pTokenAmount, bucketSigner;
    before(async function () {
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      pToken = await getContractAt("PToken", pTokenAddress);

      const bucketMockFactory = await getContractFactory("BucketMock");
      bucketMock = await bucketMockFactory.deploy();
      await bucketMock.deployed();
      bucketSigner = await getImpersonateSigner(bucketMock);
      await pToken.connect(mockBucketsFactorySigner).setBucket(bucketMock.address);
      await bucketMock.setPToken(pToken.address);
      await bucketMock.setWhiteBlackList(whiteBlackList.address);

      amountToMint = parseUnits("10", decimalsPToken);
      await bucketMock.mintPToken(deployer.address, amountToMint, RAY.toString());
      await bucketMock.setActive(true);
      pTokenAmount = await pToken.balanceOf(deployer.address);
    });

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
    it("Should revert lockDeposit when _duration is 0", async function () {
      await expect(pToken.connect(bucketSigner).lockDeposit(deployer.address, pTokenAmount, 0)).to.revertedWithCustomError(
        ErrorsLibrary,
        "DURATION_MUST_BE_MORE_THAN_0",
      );
    });

    it("Should revert lockDeposit when _amount is 0", async function () {
      await expect(pToken.connect(bucketSigner).lockDeposit(deployer.address, 0, 100)).to.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_AMOUNT",
      );
    });
    it("Should revert lockDeposit when the msg.sender is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        pToken.connect(bucketSigner).connect(mockContract).lockDeposit(deployer.address, pTokenAmount, 100),
      ).to.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });

    it("Should revert lockDeposit when the bucket is not active", async function () {
      await bucketMock.setActive(false);
      await expect(pToken.connect(bucketSigner).lockDeposit(deployer.address, pTokenAmount, 100)).to.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_NOT_ACTIVE",
      );
    });

    it("Can't lockDeposit for other user", async function () {
      await expect(pToken.connect(trader).lockDeposit(deployer.address, pTokenAmount, 100)).to.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_BUCKET",
      );
    });

    it("lockDeposit should correct update state", async function () {
      const amountToLock = pTokenAmount.div(3);
      const amountToLock2 = pTokenAmount.div(3).add(100);
      const duration = 3600; // 1 hour
      const duration2 = 7200; // 2 hours

      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock2, duration2);
      const timestamp2 = (await provider.getBlock("latest")).timestamp;

      const balance = await pToken.getUserLockedBalance(deployer.address);

      expect(balance.totalLockedBalance).to.equal(amountToLock.add(amountToLock2));
      expect(balance.deposits.length).to.equal(2);

      parseArguments(balance.deposits[0], [amountToLock, timestamp + duration, 0]);
      parseArguments(balance.deposits[1], [amountToLock2, timestamp2 + duration2, 1]);

      expect(await pToken.getDepositIndexById(0)).to.equal(0);
      expect(await pToken.getDepositIndexById(1)).to.equal(1);
    });
    it("Should revert unlockDeposit when msg.sender is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await bucketMock.mintPToken(trader.address, amountToMint, RAY.toString());
      const amountToLock = pTokenAmount.div(3);
      const duration = 3600; // 1 hour

      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration); // id=0
      await expect(pToken.connect(mockContract).unlockDeposit(0)).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert unlockDeposit when the user has no any deposits", async function () {
      await expect(pToken.connect(mockContract).unlockDeposit(0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "THERE_ARE_NO_LOCK_DEPOSITS",
      );
    });
    it("Should revert when unlockDeposit not owned user", async function () {
      await bucketMock.mintPToken(trader.address, amountToMint, RAY.toString());

      const amountToLock = pTokenAmount.div(3);
      const duration = 3600; // 1 hour

      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration); // id=0
      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration); // id=1
      await pToken.connect(bucketSigner).lockDeposit(trader.address, amountToLock, duration); // id=2
      await pToken.connect(bucketSigner).lockDeposit(trader.address, amountToLock, duration); // id=3

      await expect(pToken.unlockDeposit(3)).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_ID");
    });

    it("Should lockDeposit and throw event", async function () {
      const amountToLock = pTokenAmount.div(3);
      const duration = 3600; // 1 hour

      const tx = await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      const expectedLockDepositEvent = { user: deployer.address, id: 0, deadline: timestamp + duration, amount: amountToLock };
      eventValidation("LockDeposit", await tx.wait(), expectedLockDepositEvent);
    });

    it("Should unlockDeposit and throw event", async function () {
      const amountToLock = pTokenAmount.div(3);
      const duration = 3600; // 1 hour

      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration);
      const timestamp = (await provider.getBlock("latest")).timestamp;

      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + duration + 1]);

      const tx = await pToken.unlockDeposit(0);

      const expectedUnlockDepositEvent = { user: deployer.address, id: 0 };
      eventValidation("UnlockDeposit", await tx.wait(), expectedUnlockDepositEvent);
    });

    it("Should unlockDeposit  immediately when the bucket is delisted", async function () {
      const amountToLock = pTokenAmount.div(3);
      const duration = 3600; // 1 hour

      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration);
      await bucketMock.setDelisted(true);
      const tx = await pToken.unlockDeposit(0);
      const expectedUnlockDepositEvent = { user: deployer.address, id: 0 };
      eventValidation("UnlockDeposit", await tx.wait(), expectedUnlockDepositEvent);
    });

    it("Should revert lockDeposit when amount to lock is more available balance", async function () {
      const amountToLock = pTokenAmount.div(3);

      await expect(pToken.connect(bucketSigner).lockDeposit(deployer.address, pTokenAmount.add(1), 100)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );
      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, 100);
      await expect(pToken.connect(bucketSigner).lockDeposit(deployer.address, pTokenAmount, 100)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );
    });

    it("Should revert lockDeposit when amount to lock + amountInLiquidityMining is more than available balance", async function () {
      const amountInMining = 50;
      const LMRewardDistributor = await deployLMRewardDistributor(deployer);
      await LMRewardDistributor.mock.getLenderAmountInMining.returns(amountInMining);

      const LMParams = {
        liquidityMiningRewardDistributor: LMRewardDistributor.address,
        isBucketLaunched: false,
        accumulatingAmount: 0,
        deadlineTimestamp: 0,
        stabilizationDuration: 0,
        stabilizationEndTimestamp: 0,
        maxAmountPerUser: 0,
        maxDuration: 0,
        maxStabilizationEndTimestamp: 0,
      };
      await bucketMock.setLiquidityMiningParams(LMParams);
      await bucketMock.setCanClaimReward(false);

      await expect(pToken.connect(bucketSigner).lockDeposit(deployer.address, pTokenAmount, 100)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );
    });

    it("Should revert unlockDeposit when block.timestamp is lower or equal than deadline", async function () {
      const amountToLock = pTokenAmount.div(3);
      const duration = 3600; // 1 hour
      const id = 0;
      await pToken.connect(bucketSigner).lockDeposit(deployer.address, amountToLock, duration);
      const timestamp = (await provider.getBlock("latest")).timestamp;

      // deadline > block.timestamp
      await expect(pToken.unlockDeposit(id)).to.be.revertedWithCustomError(ErrorsLibrary, "LOCK_TIME_IS_NOT_EXPIRED");

      // deadline = block.timestamp
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + duration]);
      await expect(pToken.unlockDeposit(id)).to.be.revertedWithCustomError(ErrorsLibrary, "LOCK_TIME_IS_NOT_EXPIRED");
    });

    it("unlockDeposit should correct update state", async function () {
      const amountToLock = pTokenAmount.div(8);
      const amounts = [amountToLock, amountToLock, amountToLock.mul(2), amountToLock.mul(4)];
      const duration = 3600; // 1 hour
      const durations = [duration, duration, duration * 2, duration * 3];
      const deadlines = [];
      const depositIds = [];

      for (let i = 0; i < amounts.length; i++) {
        depositIds.push(i);
        await pToken.connect(bucketSigner).lockDeposit(deployer.address, amounts[i], durations[i]);
        deadlines.push((await provider.getBlock("latest")).timestamp + durations[i]);
      }

      await network.provider.send("evm_setNextBlockTimestamp", [deadlines[depositIds[1]] + 1]);

      await pToken.unlockDeposit(1);
      expect(await pToken.getDepositIndexById(1)).to.equal(0);
      expect(await pToken.getDepositIndexById(3)).to.equal(1);

      const balance = await pToken.getUserLockedBalance(deployer.address);
      expect(balance.totalLockedBalance).to.equal(pTokenAmount.sub(amountToLock));

      const expectedDepositsArray = [
        {
          lockedBalance: amounts[0],
          deadline: deadlines[0],
          id: depositIds[0],
        },
        {
          lockedBalance: amounts[3],
          deadline: deadlines[3],
          id: depositIds[3],
        },
        {
          lockedBalance: amounts[2],
          deadline: deadlines[2],
          id: depositIds[2],
        },
      ];
      parseArguments(expectedDepositsArray, balance.deposits);
    });
  });

  describe("Deposit", function () {
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

    it("Should only allow the admin to mint tokens", async function () {
      await expect(
        pTestTokenA.connect(lender).mint(lender.address, parseUnits("10", decimalsPToken), RAY.toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_BUCKET");
    });

    it("Should mint PTokens for given address, equal of providing TestTokenA amount", async function () {
      const amount = parseUnits("10", decimalsA);

      await testTokenA.connect(lender).approve(bucket.address, amount);

      await expect(() => bucket.connect(lender).deposit(lender.address, amount)).to.changeTokenBalance(pTestTokenA, lender, amount);
    });

    it("Should transfer testTokenA to Bucket contract", async function () {
      const amount = parseUnits("10", decimalsPToken);

      await testTokenA.connect(lender).approve(bucket.address, amount);

      await expect(() => bucket.connect(lender).deposit(lender.address, amount)).to.changeTokenBalances(
        testTokenA,
        [lender, bucket],
        [amount.mul(NegativeOne), amount],
      );
    });

    it("Should emit event 'Transfer' with correct parameters", async function () {
      const amount = parseUnits("10", decimalsPToken);

      await testTokenA.connect(lender).approve(bucket.address, amount);

      await expect(bucket.connect(lender).deposit(lender.address, amount))
        .to.emit(pTestTokenA, "Transfer")
        .withArgs(AddressZero, lender.address, amount);
    });

    it("Should emit event 'Mint' with correct parameters", async function () {
      const amount = parseUnits("10", decimalsPToken);

      await testTokenA.connect(lender).approve(bucket.address, amount);

      await expect(bucket.connect(lender).deposit(lender.address, amount)).to.emit(pTestTokenA, "Mint").withArgs(lender.address, amount);
    });
  });

  describe("balanceOf", function () {
    let snapshotId, lenderAmount;
    before(async function () {
      lenderAmount = parseUnits("10", decimalsA);
      await testTokenA.connect(lender).approve(bucket.address, lenderAmount);
      await bucket.connect(lender).deposit(lender.address, lenderAmount);
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

    it("Should return balance without change", async function () {
      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(lenderAmount);
    });

    it("Shouldn't increment balance over past 2 blocks (time past) because nobody borrowed yet", async function () {
      await network.provider.send("evm_mine");
      await network.provider.send("evm_mine");

      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(lenderAmount);
    });

    it("Should increment balance over past 3 blocks, after deposit and borrowed", async function () {
      await bucket.connect(lender).withdraw(lender.address, MaxUint256);
      const testTokenB = await getContract("TestTokenB");

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

      const depositAmount = parseUnits("15", decimalsA);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

      const borrow = lenderAmount;
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;

      const feeAmountCalculateWithETHRate = wadMul(
        BigNumber.from(depositAmount).add(borrow).toString(),
        protocolRate.toString(),
      ).toString();

      const feeAmountInEth = wadMul(
        BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
        PriceInETH.toString(),
      ).toString();

      await bucket.connect(lender).deposit(lender.address, lenderAmount);

      const tx = await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetShares,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );

      await tx.wait();
      const txBlockTimestamp = (await provider.getBlock(tx.blockNumber)).timestamp;
      const timePast = 10;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp + timePast]);
      await network.provider.send("evm_mine");
      // const blockLiquidityUpdateAgo = 1;
      const originalBalance = lenderAmount;

      // updating rates with new deposit and borrow
      const uRatio = new BN(rayDiv(borrow.toString(), lenderAmount.toString()));
      const barCalculationParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
      const BAR = calculateBar(uRatio, barCalculationParams);
      const LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));

      const liquidityIndexOld = new BN(10).exponentiatedBy(27).toFixed();
      const balanceInterest = LAR.multipliedBy(timePast).div(secondsPerYear).plus(RAY);
      const balanceCumulated = rayMul(balanceInterest, liquidityIndexOld);
      const userBalance = rayMul(originalBalance.toString(), balanceCumulated.toFixed());

      expect(await pTestTokenA.balanceOf(lender.address)).to.be.gt(lenderAmount);
      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(userBalance.toFixed());
    });
  });

  describe("availableBalanceOf", function () {
    let snapshotId, lenderAmount, bucketSigner;
    before(async function () {
      lenderAmount = parseUnits("10", decimalsA);
      await testTokenA.mint(deployer.address, lenderAmount);
      await testTokenA.connect(deployer).approve(bucket.address, lenderAmount);
      await bucket.connect(deployer).deposit(deployer.address, lenderAmount);
      bucketSigner = await getImpersonateSigner(bucket);
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

    it("Should availableBalanceOf be equal to balanceOf", async function () {
      const testTokenB = await getContract("TestTokenB");

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

      const depositAmount = parseUnits("15", decimalsA);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

      const borrow = lenderAmount;
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;

      const feeAmountCalculateWithETHRate = wadMul(
        BigNumber.from(depositAmount).add(borrow).toString(),
        protocolRate.toString(),
      ).toString();
      const feeAmountInEth = wadMul(
        BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
        PriceInETH.toString(),
      ).toString();

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetShares,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );

      const blockPast = 3;
      for (let i = 0; i < blockPast; i++) {
        await network.provider.send("evm_mine");
      }

      expect(await pTestTokenA.availableBalanceOf(lender.address)).to.equal(await pTestTokenA.balanceOf(lender.address));
    });

    it("Should update availableBalanceOf after lockDeposit", async function () {
      const amountToLock = lenderAmount.div(16);
      const amounts = [amountToLock, amountToLock, amountToLock.mul(2), amountToLock.mul(4)];
      const duration = 3600; // 1 hour
      const durations = [duration, duration, duration * 2, duration * 3];

      let availableBalance = lenderAmount;
      for (let i = 0; i < amounts.length; i++) {
        await pTestTokenA.connect(bucketSigner).lockDeposit(deployer.address, amounts[i], durations[i]);
        availableBalance = availableBalance.sub(amounts[i]);
      }

      expect(await pTestTokenA.availableBalanceOf(deployer.address)).to.equal(availableBalance);
    });

    it("Should update availableBalanceOf after unlockDeposit", async function () {
      const amountToLock = lenderAmount.div(16);
      const amounts = [amountToLock, amountToLock, amountToLock.mul(2), amountToLock.mul(4)];
      const duration = 3600; // 1 hour
      const durations = [duration, duration, duration * 2, duration * 3];

      let availableBalance = lenderAmount;
      for (let i = 0; i < amounts.length; i++) {
        await pTestTokenA.connect(bucketSigner).lockDeposit(deployer.address, amounts[i], durations[i]);
        availableBalance = availableBalance.sub(amounts[i]);
      }
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + 4 * duration]);

      const idToClose = [1, 3];
      for (const id of idToClose) {
        await pTestTokenA.unlockDeposit(id);
        availableBalance = availableBalance.add(amounts[id]);
      }

      expect(await pTestTokenA.availableBalanceOf(deployer.address)).to.equal(availableBalance);
    });
  });

  describe("Transfers and allowances", function () {
    let initialLenderAmount, bucketSigner;
    let snapshotId;
    before(async function () {
      initialLenderAmount = parseUnits("40", decimalsA);
      await testTokenA.mint(bucket.address, initialLenderAmount);

      await testTokenA.connect(lender).approve(bucket.address, initialLenderAmount);
      await bucket.connect(lender).deposit(lender.address, initialLenderAmount);
      bucketSigner = await getImpersonateSigner(bucket);
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

      const testTokenB = await getContract("TestTokenB");
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      const depositAmount = parseUnits("15", decimalsA);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

      const borrow = parseUnits("20", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const feeAmountCalculateWithETHRate = wadMul(
        BigNumber.from(depositAmount).add(borrow).toString(),
        protocolRate.toString(),
      ).toString();
      const feeAmountInEth = wadMul(
        BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
        PriceInETH.toString(),
      ).toString();

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetShares,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should return total supply equals balanceOf lender", async function () {
      const currentBalance = await pTestTokenA.balanceOf(lender.address);
      const currentTotalSupply = await pTestTokenA.totalSupply();

      expect(currentBalance).to.equal(currentTotalSupply);
    });

    it("Should return correct balances of two users after pToken transfer", async function () {
      const transferAmount = parseUnits("5", decimalsPToken);
      const lenderBalanceBefore = await pTestTokenA.balanceOf(lender.address);
      const recipientBalanceBefore = await pTestTokenA.balanceOf(recipient.address);
      const totalSupplyBefore = await pTestTokenA.totalSupply();

      expect(recipientBalanceBefore).to.equal(0);

      await pTestTokenA.connect(lender).transfer(recipient.address, transferAmount);
      const blockPast = 300;
      for (let i = 0; i < blockPast; i++) {
        await network.provider.send("evm_mine");
      }
      const totalSupplyAfter = await pTestTokenA.totalSupply();
      const lenderBalanceAfter = await pTestTokenA.balanceOf(lender.address);
      const recipientBalanceAfter = await pTestTokenA.balanceOf(recipient.address);

      // TODO: rounding error. closeTo -> equal
      expect(totalSupplyAfter).to.closeTo(lenderBalanceAfter.add(recipientBalanceAfter), 1);
      expect(lenderBalanceBefore).to.be.gt(lenderBalanceAfter);

      expect(lenderBalanceBefore).to.be.lt(lenderBalanceAfter.add(recipientBalanceAfter));
      expect(totalSupplyBefore).to.be.lt(totalSupplyAfter);
    });

    it("Should increase pToken totalSupply when some amount of blocks past", async function () {
      const totalSupplyBeforeActual = await pTestTokenA.totalSupply();

      const blockPast = 300;
      for (let i = 0; i < blockPast; i++) {
        await network.provider.send("evm_mine");
      }

      const normalizedIncome = await bucket.getNormalizedIncome();
      const totalSupplyAfterExpected = rayMul(totalSupplyBeforeActual.toString(), normalizedIncome.toString()).toString();
      const totalSupplyAfterActual = await pTestTokenA.totalSupply();

      expect(totalSupplyBeforeActual).to.be.lt(totalSupplyAfterActual);
      expect(totalSupplyAfterExpected).to.be.equal(totalSupplyAfterActual);
    });

    it("Should revert transfer() when a param 'address _recipient' is zero", async function () {
      await expect(pTestTokenA.connect(lender).transfer(AddressZero, parseUnits("5", decimalsPToken))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert transfer when the recipient is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(pTestTokenA.connect(lender).transfer(mockContract.address, 1)).to.revertedWithCustomError(
        ErrorsLibrary,
        "RECIPIENT_IS_BLACKLISTED",
      );
    });

    it("Should update allowance after approve was changed", async function () {
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(0);

      await pTestTokenA.connect(lender).approve(lender2.address, 500);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(500);

      await pTestTokenA.connect(lender).decreaseAllowance(lender2.address, 100);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(400);

      await pTestTokenA.connect(lender).increaseAllowance(lender2.address, 200);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(600);

      await pTestTokenA.connect(lender).approve(lender2.address, 1000);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(1000);

      await pTestTokenA.connect(lender).approve(lender2.address, 0);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(0);
    });

    it("Should return correct balances of two users after pToken transferFrom and decrease allowance", async function () {
      const amount = parseUnits("7.5", decimalsPToken);
      await pTestTokenA.connect(lender).approve(lender2.address, amount);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(amount);

      await pTestTokenA.connect(lender2).transferFrom(lender.address, recipient.address, amount);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(0);

      // and when block passed
      await network.provider.send("evm_mine");

      const lenderNewBalance = await pTestTokenA.balanceOf(lender.address);
      const recipientNewBalance = await pTestTokenA.balanceOf(recipient.address);
      expect(await pTestTokenA.totalSupply()).to.equal(lenderNewBalance.add(recipientNewBalance));

      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.equal(0);
      await expect(
        pTestTokenA.connect(lender2).transferFrom(lender.address, recipient.address, parseUnits("11", decimalsPToken)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TRANSFER_AMOUNT_EXCEED_ALLOWANCE");
    });

    it("Should revert transferFrom() when a param 'address _sender' is zero", async function () {
      await expect(
        pTestTokenA.connect(lender).transferFrom(AddressZero, recipient.address, parseUnits("1", decimalsPToken)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert transferFrom() when a param 'address _recipient' is zero", async function () {
      await expect(
        pTestTokenA.connect(lender).transferFrom(lender.address, AddressZero, parseUnits("1", decimalsPToken)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert transferFrom when the recipient is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(pTestTokenA.connect(lender).transferFrom(lender.address, mockContract.address, 1)).to.revertedWithCustomError(
        ErrorsLibrary,
        "RECIPIENT_IS_BLACKLISTED",
      );
    });

    it("Should transfer full user balance to another user", async function () {
      await network.provider.send("evm_mine");
      await pTestTokenA.connect(lender).transfer(recipient.address, MaxUint256);
      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(0);

      const blockPast = 300;
      for (let i = 0; i < blockPast; i++) {
        await network.provider.send("evm_mine");
      }
      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(0);
      expect(await pTestTokenA.balanceOf(recipient.address)).to.be.gt(initialLenderAmount);
    });

    it("Should transfer full user balance to another user using transferFrom", async function () {
      await network.provider.send("evm_mine");
      await pTestTokenA.connect(lender).approve(lender2.address, MaxUint256);
      await pTestTokenA.connect(lender2).transferFrom(lender.address, recipient.address, MaxUint256);
      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(0);

      const blockPast = 300;
      for (let i = 0; i < blockPast; i++) {
        await network.provider.send("evm_mine");
      }

      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(0);
      expect(await pTestTokenA.balanceOf(recipient.address)).to.be.gt(initialLenderAmount);
      expect(await pTestTokenA.allowance(lender.address, lender2.address)).to.be.lt(MaxUint256);
    });

    it("Should revert transfer if amount is more available balance", async function () {
      await pTestTokenA.connect(bucketSigner).lockDeposit(lender.address, initialLenderAmount.div(2), 3600);
      await expect(pTestTokenA.connect(lender).transfer(recipient.address, initialLenderAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );
    });

    it("Should revert transferFrom if amount is more available balance", async function () {
      await pTestTokenA.connect(bucketSigner).lockDeposit(lender.address, initialLenderAmount.div(2), 3600);
      await expect(
        pTestTokenA.connect(deployer).transferFrom(lender.address, recipient.address, initialLenderAmount),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ACTION_ONLY_WITH_AVAILABLE_BALANCE");
    });
    it("Should revert transfer if amount + amountInLiquidityMining is more than available balance", async function () {
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      const pToken = await getContractAt("PToken", pTokenAddress);

      const bucketMockFactory = await getContractFactory("BucketMock");
      const bucketMock = await bucketMockFactory.deploy();
      await bucketMock.deployed();

      await pToken.connect(mockBucketsFactorySigner).setBucket(bucketMock.address);
      await bucketMock.setPToken(pToken.address);
      await bucketMock.setWhiteBlackList(whiteBlackList.address);

      const amountToMint = parseUnits("10", decimalsPToken);
      await bucketMock.mintPToken(lender.address, amountToMint, RAY.toString());
      const pTokenAmount = await pToken.balanceOf(lender.address);

      const amountInMining = pTokenAmount.div(2);
      const LMRewardDistributor = await deployLMRewardDistributor(deployer);
      await LMRewardDistributor.mock.getLenderAmountInMining.returns(amountInMining);

      const LMParams = {
        liquidityMiningRewardDistributor: LMRewardDistributor.address,
        isBucketLaunched: false,
        accumulatingAmount: 0,
        deadlineTimestamp: 0,
        stabilizationDuration: 0,
        stabilizationEndTimestamp: 0,
        maxAmountPerUser: 0,
        maxDuration: 0,
        maxStabilizationEndTimestamp: 0,
      };
      await bucketMock.setLiquidityMiningParams(LMParams);
      await bucketMock.setCanClaimReward(false);

      await expect(pToken.connect(lender).transfer(recipient.address, pTokenAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );
    });
    it("Should revert transferFrom if amount + amountInLiquidityMining is more available balance", async function () {
      const tx = await pTokensFactory.connect(mockBucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txReceipt = await tx.wait();
      const pTokenAddress = addressFromEvent("PTokenCreated", txReceipt);
      const pToken = await getContractAt("PToken", pTokenAddress);

      const bucketMockFactory = await getContractFactory("BucketMock");
      const bucketMock = await bucketMockFactory.deploy();
      await bucketMock.deployed();

      await pToken.connect(mockBucketsFactorySigner).setBucket(bucketMock.address);
      await bucketMock.setPToken(pToken.address);

      const amountToMint = parseUnits("10", decimalsPToken);
      await bucketMock.mintPToken(lender.address, amountToMint, RAY.toString());
      const pTokenAmount = await pToken.balanceOf(lender.address);

      const amountInMining = pTokenAmount.div(2);
      const LMRewardDistributor = await deployLMRewardDistributor(deployer);
      await LMRewardDistributor.mock.getLenderAmountInMining.returns(amountInMining);

      const LMParams = {
        liquidityMiningRewardDistributor: LMRewardDistributor.address,
        isBucketLaunched: false,
        accumulatingAmount: 0,
        deadlineTimestamp: 0,
        stabilizationDuration: 0,
        stabilizationEndTimestamp: 0,
        maxAmountPerUser: 0,
        maxDuration: 0,
        maxStabilizationEndTimestamp: 0,
      };
      await bucketMock.setLiquidityMiningParams(LMParams);
      await bucketMock.setCanClaimReward(false);

      await expect(
        pTestTokenA.connect(deployer).transferFrom(lender.address, recipient.address, pTokenAmount),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ACTION_ONLY_WITH_AVAILABLE_BALANCE");
    });
  });

  describe("Total supply", function () {
    let snapshotId;
    before(async function () {
      const amount = parseUnits("40", decimalsA);
      await testTokenA.mint(bucket.address, amount);
      await testTokenA.mint(lender2.address, amount);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender).deposit(lender.address, amount);

      await testTokenA.connect(lender2).approve(bucket.address, MaxUint256);
      await bucket.connect(lender2).deposit(lender.address, amount);
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

      const testTokenB = await getContract("TestTokenB");
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      const depositAmount = parseUnits("15", decimalsA);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

      const borrow = parseUnits("20", decimalsA);
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const feeAmountCalculateWithETHRate = wadMul(
        BigNumber.from(depositAmount).add(borrow).toString(),
        protocolRate.toString(),
      ).toString();
      const feeAmountInEth = wadMul(
        BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
        PriceInETH.toString(),
      ).toString();

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrow,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: assetShares,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should return total supply equals balanceOf lender", async function () {
      await network.provider.send("evm_mine");
      const currentBalance1 = await pTestTokenA.balanceOf(lender.address);
      const currentBalance2 = await pTestTokenA.balanceOf(lender2.address);

      const currentTotalSupply = await pTestTokenA.totalSupply();

      expect(currentTotalSupply).to.equal(currentBalance1.add(currentBalance2));
    });

    it("Should return totalSupply equals to all user's balances", async function () {
      const transferAmount = parseUnits("10", decimalsPToken);
      await pTestTokenA.connect(lender).transfer(recipient.address, transferAmount);

      await network.provider.send("evm_mine");
      await network.provider.send("evm_mine");
      await network.provider.send("evm_mine");

      const lenderBalance1 = await pTestTokenA.scaledBalanceOf(lender.address);
      const lenderBalance2 = await pTestTokenA.scaledBalanceOf(lender2.address);
      const recipientBalance = await pTestTokenA.scaledBalanceOf(recipient.address);

      expect(await pTestTokenA.scaledTotalSupply()).to.equal(lenderBalance1.add(lenderBalance2).add(recipientBalance));
    });
  });

  describe("burn", function () {
    let snapshotId, amount, bucketSigner;
    before(async function () {
      amount = parseUnits("10", decimalsA);
      await testTokenA.mint(bucket.address, amount);
      await testTokenA.connect(lender).approve(bucket.address, amount);
      await bucket.connect(lender).deposit(lender.address, amount);
      bucketSigner = await getImpersonateSigner(bucket);
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

    it("Should only allow the bucket to burn tokens", async function () {
      await expect(
        pTestTokenA.connect(lender).burn(lender.address, parseUnits("10", decimalsPToken), RAY.toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_BUCKET");
    });

    it("Should burn PTokens and transfer correct amount of underlying asset to user", async function () {
      await expect(() => bucket.connect(lender).withdraw(recipient.address, amount)).to.changeTokenBalance(
        pTestTokenA,
        lender,
        amount.mul(NegativeOne),
      );
    });

    it("Should transfer testTokenA to user", async function () {
      const particleToRecipient = BigNumber.from(WAD).sub(BigNumber.from(withdrawalFeeRate));
      const amountToRecipient = BigNumber.from(wadMul(particleToRecipient.toString(), amount.toString()).toString());
      await expect(() => bucket.connect(lender).withdraw(recipient.address, amount)).to.changeTokenBalances(
        testTokenA,
        [recipient, bucket],
        [amountToRecipient, amount.mul(NegativeOne)],
      );
    });

    it("Should emit event 'Transfer' with correct parameters", async function () {
      await expect(bucket.connect(lender).withdraw(recipient.address, amount))
        .to.emit(pTestTokenA, "Transfer")
        .withArgs(lender.address, AddressZero, amount);
    });

    it("Should emit event 'Burn' with correct parameters", async function () {
      await testTokenA.connect(lender).approve(pTestTokenA.address, amount);

      await expect(bucket.connect(lender).withdraw(recipient.address, amount))
        .to.emit(pTestTokenA, "Burn")
        .withArgs(lender.address, amount);
    });

    it("Should burn PTokens and transfer correct amount of underlying asset to user after 2 blocks", async function () {
      await network.provider.send("evm_mine");
      await network.provider.send("evm_mine");

      const incrementedBalance = await pTestTokenA.balanceOf(lender.address);

      const particleToRecipient = BigNumber.from(WAD).sub(BigNumber.from(withdrawalFeeRate));
      const amountToRecipient = BigNumber.from(wadMul(particleToRecipient.toString(), incrementedBalance.toString()).toString());
      await expect(() => bucket.connect(lender).withdraw(recipient.address, incrementedBalance)).to.changeTokenBalances(
        testTokenA,
        [recipient, bucket],
        [amountToRecipient, incrementedBalance.mul(NegativeOne)],
      );
    });

    it("Should return zero balance of PTokens, when user burn MaxUint of PTokens 2 blocks after deposit", async function () {
      await network.provider.send("evm_mine");
      await network.provider.send("evm_mine");

      await bucket.connect(lender).withdraw(recipient.address, MaxUint256);

      expect(await pTestTokenA.balanceOf(lender.address)).to.equal(0);
    });

    it("Can burn only available PToken amount", async function () {
      const balance = await pTestTokenA.availableBalanceOf(lender.address);
      await pTestTokenA.connect(bucketSigner).lockDeposit(lender.address, balance.div(2), 3600);

      await expect(bucket.connect(lender).withdraw(recipient.address, balance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ACTION_ONLY_WITH_AVAILABLE_BALANCE",
      );

      const availableBalance = await pTestTokenA.availableBalanceOf(lender.address);
      await bucket.connect(lender).withdraw(recipient.address, availableBalance);
    });
  });
});
