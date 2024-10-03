// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  upgrades,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, NegativeOne, AddressZero, Zero },
    BigNumber,
  },
  deployments: { fixture, getArtifact },
} = require("hardhat");

const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  CloseReason,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  PaymentModel,
  KeeperActionType,
  CallingMethod,
  ArbGasInfo,
  NATIVE_CURRENCY,
  USD_DECIMALS,
  USD_MULTIPLIER,
} = require("./utils/constants");
const { SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../Constants");
const { FeeRateType } = require("./utils/constants");
const { getConfigByName } = require("../config/configUtils");
const {
  PrimexDNSconfig: { feeRates },
} = getConfigByName("generalConfig.json");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { increaseBlocksBy, getImpersonateSigner, getAdminSigners } = require("./utils/hardhatUtils");
const { calculateFeeAmountInPmx } = require("./utils/protocolUtils");
const {
  getAmountsOut,
  addLiquidity,
  getPair,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getSingleMegaRoute,
} = require("./utils/dexOperations");
const { deployMockReserve, deployMockERC20 } = require("./utils/waffleMocks");
const { getTakeProfitStopLossParams, getCondition } = require("./utils/conditionParams");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
  setBadOraclePrice,
  getExchangeRateByRoutes,
} = require("./utils/oracleUtils");
const { barCalcParams } = require("./utils/defaultBarCalcParams");
const { eventValidation, getDecodedEvents } = require("./utils/eventValidation");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");

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
    PrimexPricingLibrary,
    activityRewardDistributor,
    bucketAddress,
    firstAssetRoutes,
    routesForClose,
    interestRateStrategy,
    whiteBlackList,
    mockContract;
  let pair;
  let MediumTimelockAdmin;
  let priceOracle;
  let deployer, trader, lender, liquidator;
  let snapshotIdBase;
  let mockReserve;
  let increaseBy;
  let decimalsA, decimalsB;
  let multiplierA, multiplierB;
  let tokenTransfersLibrary;
  let OpenPositionParams;
  let positionAmount, price, depositAmount, borrowedAmount, swapSize, ttaPriceInETH;
  let PMXToken;
  let ErrorsLibrary, treasury;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender, liquidator } = await getNamedSigners());
    ({ MediumTimelockAdmin } = await getAdminSigners());
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
    PrimexPricingLibrary = await getContract("PrimexPricingLibrary");

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
    firstAssetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);
    routesForClose = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

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

    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    mockReserve = await deployMockReserve(deployer);

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    increaseBy = 2628000; // calculated for a year from average 7200 blocks per day on Ethereum

    depositAmount = parseUnits("25", decimalsA);
    borrowedAmount = parseUnits("25", decimalsA);
    swapSize = depositAmount.add(borrowedAmount);

    const lenderAmount = parseUnits("50", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
    await testTokenA.connect(trader).approve(positionManager.address, depositAmount);
    const deadline = new Date().getTime() + 600;

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
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
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const price0 = wadDiv(amountB.toString(), swap.toString()).toString();
    price = BigNumber.from(price0).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price);

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
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
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
    };
  });

  describe("initialize", function () {
    let batchManagerFactory, registryAddress, deployBM, args, gasPerPosition, gasPerBatch;
    before(async function () {
      const PositionLibrary = await getContract("PositionLibrary");
      const PrimexPricingLibrary = await getContract("PrimexPricingLibrary");
      registryAddress = (await getContract("Registry")).address;
      gasPerPosition = "100000";
      gasPerBatch = "50000";

      batchManagerFactory = await getContractFactory("BatchManager", {
        libraries: {
          PositionLibrary: PositionLibrary.address,
          PrimexPricingLibrary: PrimexPricingLibrary.address,
          TokenTransfersLibrary: tokenTransfersLibrary.address,
        },
      });

      deployBM = async function deployBM(args) {
        return await upgrades.deployProxy(batchManagerFactory, [...args], {
          unsafeAllow: ["constructor", "delegatecall", "external-library-linking"],
        });
      };
      // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
      await upgrades.silenceWarnings();
    });
    beforeEach(async function () {
      args = [positionManager.address, priceOracle.address, whiteBlackList.address, registryAddress, gasPerPosition, gasPerBatch];
    });
    it("Should deploy dexAdapter and set the correct PM and PriceOracle", async function () {
      const batchManager = await deployBM(args);
      expect(await batchManager.positionManager()).to.be.equal(positionManager.address);
      expect(await batchManager.priceOracle()).to.be.equal(priceOracle.address);
      expect(await batchManager.whiteBlackList()).to.be.equal(whiteBlackList.address);
      expect(await batchManager.registry()).to.be.equal(registryAddress);
      expect(await batchManager.gasPerPosition()).to.be.equal(gasPerPosition);
      expect(await batchManager.gasPerBatch()).to.be.equal(gasPerBatch);
    });
    it("Should revert when a param '_positionManager' is not supported", async function () {
      args[0] = PrimexDNS.address;
      await expect(deployBM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when a param '_priceOracle' is not supported", async function () {
      args[1] = PrimexDNS.address;
      await expect(deployBM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when a param '_whiteBlackList' is not supported", async function () {
      args[2] = PrimexDNS.address;
      await expect(deployBM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when a param '_registry' is not supported", async function () {
      args[3] = PrimexDNS.address;
      await expect(deployBM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
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

  describe("sets", function () {
    let gasPerPosition, gasPerBatch;

    before(async function () {
      gasPerPosition = "100000";
      gasPerBatch = "50000";
    });
    it("Should set gasPerAction and emit event", async function () {
      await expect(batchManager.connect(MediumTimelockAdmin).setGasPerPosition(gasPerPosition))
        .to.emit(batchManager, "ChangeGasPerPosition")
        .withArgs(gasPerPosition);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setGasPerAction", async function () {
      await expect(batchManager.connect(trader).setGasPerPosition(gasPerPosition)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should set gasPerBatch and emit event", async function () {
      await expect(batchManager.connect(MediumTimelockAdmin).setGasPerBatch(gasPerBatch))
        .to.emit(batchManager, "ChangeGasPerBatch")
        .withArgs(gasPerBatch);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setGasPerBatch", async function () {
      await expect(batchManager.connect(trader).setGasPerBatch(gasPerBatch)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
  describe("closeBatchPositions", function () {
    let snapshotId;
    let positionAmount0;
    let positionAmount1;
    let totalPositionAmount, ethAddress;
    const shares = [];
    let borrowedAmount;
    let limitPrice;
    before(async function () {
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.mint(lender.address, parseUnits("100", decimalsA));
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("50", decimalsA), true);
      borrowedAmount = parseUnits("30", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      ethAddress = await priceOracle.eth();
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), BigNumber.from(limitPrice).mul(20))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      // to avoid the different price error
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amount0Out,
        path: [testTokenB.address, testTokenA.address],
      });

      await positionManager.connect(trader).openPosition(OpenPositionParams);
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when the passed sold asset doesn't match the sold asset of the spot positions", async function () {
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      await positionManager.connect(trader).openPosition(OpenPositionParams);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BATCH_CANNOT_BE_CLOSED_FOR_THIS_REASON");
    });
    it("Should revert if in any of the positions the position size is smaller than minProtocolFee", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const numberOfPositions = 2;
      const gasPerBatch = await batchManager.gasPerBatch();
      const gasPerPosition = await batchManager.gasPerPosition();
      const estimatedGasAmount = (gasPerBatch.toNumber() / numberOfPositions + gasPerPosition.toNumber()).toString();

      const gasPrice = BigNumber.from(positionAmount0).div(estimatedGasAmount);

      OpenPositionParams.marginParams.borrowedAmount = parseUnits("0.1", decimalsA);
      OpenPositionParams.depositAmount = parseUnits("0.1", decimalsA);

      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      let amountB = amountOut.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      let price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
            { gasPrice: gasPrice },
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "MIN_PROTOCOL_FEE_IS_GREATER_THAN_PAYMENT_AMOUNT");
    });
    it("Shouldn't liquidate position until it is not risky", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
    });
    it("Should liquidate position if it's not risky but positionAsset is removed from allowedAsset of this bucket", async function () {
      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
    });

    it("Should liquidate positions by BUCKET_DELISTED reason and return the rest of deposit to trader", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10000", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const amountB = totalPositionAmount.mul(multiplierB);
      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = wadMul(amount0Out.toString(), feeRate.toString()).toString();
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
      const feeInPaymentAsset0 = BigNumber.from(feeInPaymentAsset).mul(shareOfBorrowedAmountOut0).div(amount0Out);
      const feeInPaymentAsset1 = BigNumber.from(feeInPaymentAsset).mul(shareOfBorrowedAmountOut1).div(amount0Out);

      const returnedToTrader0 = shareOfBorrowedAmountOut0.sub(positionDebt0).sub(feeInPaymentAsset0);
      const returnedToTrader1 = shareOfBorrowedAmountOut1.sub(positionDebt1).sub(feeInPaymentAsset1);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalances(
        testTokenA,
        [bucket, traderBalanceVault],
        [
          amount0Out.sub(feeInPaymentAsset).sub(returnedToTrader0.add(returnedToTrader1)).add(1),
          returnedToTrader0.add(returnedToTrader1).sub(1),
        ],
      );
      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(returnedToTrader0.add(returnedToTrader1).sub(1));
    });

    it("Should revert liquidate positions by BUCKET_DELISTED reason if bucket isn't delisted", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
      const price = wadDiv(amountB0.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
      const securityBuffer = await positionManager.securityBuffer();

      const positionDebt0 = await positionManager.getPositionDebt(0);
      const positionDebt1 = await positionManager.getPositionDebt(1);
      const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));

      let amount0OutOracle = wadMul(amountB0.toString(), priceFromOracle.mul(multiplierA).toString()).toString();
      amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();
      let amount1OutOracle = wadMul(amountB1.toString(), priceFromOracle.mul(multiplierA).toString()).toString();
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
      expect(positionState0).to.be.lt(bnWAD);
      expect(positionState1).to.be.lt(bnWAD);

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenB, [positionManager, pair], [totalPositionAmount.mul(NegativeOne), totalPositionAmount]);
    });

    it("Should revert batchClosePosition if position does not exist", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB = totalPositionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 100, 1, 200],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [],
            CloseReason.BATCH_LIQUIDATION,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_DOES_NOT_EXIST");
    });

    it("Should liquidate 2 out of 2 position", async function () {
      // open the third position with a small debt so that the position could not be liquidated
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      const swap = swapSize.mul(multiplierA);
      let amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      // make 2 out of 2 positions risky
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      amountOut = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amountOut.mul(multiplierA);
      price = wadDiv(amountB0.toString(), amountA.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      const txReceipt = await tx.wait();
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should revert when closing a batch of several identical ids", async function () {
      // open the third position with a small debt so that the position could not be liquidated
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);

      let swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      let swap = swapSize.mul(multiplierA);
      let amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      let amountB = amountOut.mul(multiplierB);
      let limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      let price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      OpenPositionParams.marginParams.borrowedAmount = parseUnits("1", decimalsA);
      OpenPositionParams.depositAmount = parseUnits("10", decimalsA);
      swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);

      swap = swapSize.mul(multiplierA);
      amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amountOut.mul(multiplierB);
      limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      // make 3 out of 4 positions risky
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("2", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountB0.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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

      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should calculate permanentLossScaled after bucket's indexes update", async function () {
      const amountB = totalPositionAmount.mul(multiplierB);
      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = wadMul(amount0Out.toString(), feeRate.toString()).toString();
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

      const positionAmountInBorrowedAsset = amount0Out;

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance0 = (await positionManager.getPosition(0)).scaledDebtAmount;
      const scaledDebtBalance1 = (await positionManager.getPosition(1)).scaledDebtAmount;

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt0 = rayMul(
        scaledDebtBalance0.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const positionDebt1 = rayMul(
        scaledDebtBalance1.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      ).toString();

      const permanentLoss = BigNumber.from(positionDebt0)
        .add(BigNumber.from(positionDebt1))
        .sub(positionAmountInBorrowedAsset)
        .add(feeInPaymentAsset); // goes to batchDecrease...

      const liquidityIndexBeforeCloseBatch = await bucket.liquidityIndex();
      const permanentLossScaledUsingLiquidityIndexBefore = rayDiv(
        permanentLoss.toString(),
        liquidityIndexBeforeCloseBatch.toString(),
      ).toString();
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
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

      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
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

      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
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
      const price = wadDiv(amountB.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
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
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenA, [bucket, treasury], [BigNumber.from(positionDebt1).add(positionDebt0), amountToTreasure]);
    });
    it("Should close positions by SL when oracle exchange rate < WAD", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

      const exchangeRate = await priceOracle.callStatic.getExchangeRate(
        testTokenB.address,
        testTokenA.address,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      expect(exchangeRate).to.be.lt(WAD);

      expect(
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      );
    });

    it("Should close positions by SL and correct updating of ActivityRewardDistributor when closing all user positions", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );

      const { oldBalance } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupply = await debtTokenA.scaledTotalSupply();
      const balanceOfBeforeAfter = await debtTokenA.scaledBalanceOf(trader.address);
      expect(oldBalance).to.be.equal(totalSupply).to.be.equal(balanceOfBeforeAfter).to.be.equal(Zero);
    });

    it("Should close positions by SL and correct calculate fee amount when feeInPaymentAsset > maxProtocolFee", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const feeInPaymentAsset = wadMul(totalAmountOut.toString(), feeRate.toString()).toString();
      const maxProtocolFee = BigNumber.from(feeInPaymentAsset).div(4);

      let rate = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()));
      const maxfee = wadMul(maxProtocolFee.toString(), rate.toString()).toString();

      await PrimexDNS.setMaxProtocolFee(maxfee);

      // check that all the values after mint are the same
      const { oldBalance: oldBalanceBefore } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupplyBefore = await debtTokenA.scaledTotalSupply();
      const balanceOfBefore = await debtTokenA.scaledBalanceOf(trader.address);

      expect(oldBalanceBefore).to.be.equal(totalSupplyBefore).to.be.equal(balanceOfBefore);
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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );

      rate = await getExchangeRateByRoutes(testTokenA, await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()));
      const maxFeeInPaymentAsset = wadDiv(maxfee.toString(), rate.toString()).toString();
      await expect(tx).to.changeTokenBalance(testTokenA, treasury, BigNumber.from(maxFeeInPaymentAsset).mul(2));

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
      await positionManager.connect(trader).openPosition(OpenPositionParams);

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      const price = BigNumber.from(totalPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      // check that all the values after mint are the same
      const { oldBalance: oldBalanceBefore } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupplyBefore = await debtTokenA.scaledTotalSupply();
      const balanceOfBefore = await debtTokenA.scaledBalanceOf(trader.address);
      const primexLens = await getContract("PrimexLens");

      await primexLens.callStatic.isStopLossReached(positionManager.address, 0, getEncodedChainlinkRouteViaUsd(testTokenA));
      await primexLens.callStatic.isStopLossReached(positionManager.address, 1, getEncodedChainlinkRouteViaUsd(testTokenA));
      await primexLens.callStatic.isStopLossReached(positionManager.address, 2, getEncodedChainlinkRouteViaUsd(testTokenA));

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );

      const { oldBalance } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupply = await debtTokenA.scaledTotalSupply();
      const balanceOfBeforeAfter = await debtTokenA.scaledBalanceOf(trader.address);
      expect(oldBalance).to.be.equal(totalSupply).to.be.equal(balanceOfBeforeAfter);
    });
    it("Should close positions by SL and return the rest of deposit to trader", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), BigNumber.from(limitPrice).mul(30))),
      ];

      await positionManager.connect(trader).updatePositionConditions(0, closeConditions);
      await positionManager.connect(trader).updatePositionConditions(1, closeConditions);

      const totalAmountB = totalPositionAmount.mul(multiplierB);

      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

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

      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const amount0Out = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = wadMul(amount0Out.toString(), feeRate.toString()).toString();

      const shareOfBorrowedAmountOut0 = positionAmount0.mul(totalAmountOut).div(totalPositionAmount);
      const shareOfBorrowedAmountOut1 = positionAmount1.mul(totalAmountOut).div(totalPositionAmount);
      const feeInPaymentAsset0 = BigNumber.from(feeInPaymentAsset).mul(shareOfBorrowedAmountOut0).div(amount0Out);
      const feeInPaymentAsset1 = BigNumber.from(feeInPaymentAsset).mul(shareOfBorrowedAmountOut1).div(amount0Out);

      const returnedToTrader0 = shareOfBorrowedAmountOut0.sub(positionDebt0).sub(feeInPaymentAsset0);
      const returnedToTrader1 = shareOfBorrowedAmountOut1.sub(positionDebt1).sub(feeInPaymentAsset1);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(returnedToTrader0.add(returnedToTrader1).sub(1));
    });

    it("Should close 2 positions by SL and ensuring the correct closing condition", async function () {
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("20", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      const txReceipt = await tx.wait();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      const events = getDecodedEvents("ClosePosition", txReceipt, await getContractAt("PositionLibrary", batchManager.address));
      expect(events.length).to.be.equal(2);
    });

    it("Should be able to close spot positions by TP/SL", async function () {
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      OpenPositionParams.depositAmount = parseUnits("10", decimalsA);
      const swapSize = OpenPositionParams.depositAmount.mul(2);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      const exchRate = wadDiv(amountB.toString(), swap.toString()).toString();
      let price = BigNumber.from(exchRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, BigNumber.from(exchRate).mul(10000))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      await positionManager.connect(trader).openPosition(OpenPositionParams);

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountB0.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

      // expect(await positionManager.callStatic.canBeClosed(2, 0, [])).to.be.equal(true);

      const { positionAmount: positionAmount2 } = await positionManager.getPosition(2);
      const { positionAmount: positionAmount3 } = await positionManager.getPosition(3);
      const totalPositionAmount23 = positionAmount2.add(positionAmount3);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount23, [testTokenB.address, testTokenA.address]);
      const shareOfBorrowedAmountOut2 = positionAmount2.mul(totalAmountOut).div(totalPositionAmount23);
      const shareOfBorrowedAmountOut3 = positionAmount3.mul(totalAmountOut).div(totalPositionAmount23);

      const feeRate = parseEther(feeRates.SpotPositionClosedByKeeper);
      const feeInPaymentAsset = wadMul(totalAmountOut.toString(), feeRate.toString()).toString();

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, traderBalanceVault, totalAmountOut.sub(feeInPaymentAsset).sub(1));

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter.sub(balanceBefore).add(feeInPaymentAsset).add(1)).to.equal(totalTokenA);
    });

    it("Should revert spot batch close if it doesn't pass oracle check", async function () {
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
      const swapSize = OpenPositionParams.depositAmount.mul(2);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      const priceRate = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(priceRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, BigNumber.from(priceRate).mul(10000))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      await positionManager.connect(trader).openPosition(OpenPositionParams);

      await setBadOraclePrice(testTokenB, testTokenA);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });

    it("Should revert if at least one position is spot and bucket is not AddressZero", async function () {
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      // create spot position
      OpenPositionParams.marginParams.borrowedAmount = 0;
      OpenPositionParams.marginParams.bucket = "";
      OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
      const swapSize = OpenPositionParams.depositAmount.mul(2);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_BUCKET_IS_INCORRECT");
    });

    it("Should revert batch close if at least one can't be closed by TP", async function () {
      // open the third position with high take profit so that the position could not be closed
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      OpenPositionParams.marginParams.borrowedAmount = parseUnits("0.1", decimalsA);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(MaxUint256.div(WAD), 1)),
      ];

      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountB0.toString(), amountA.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
    });

    it("Should revert close by SL if first position has wrong close manager", async function () {
      // open the third position with low stop loss so that the position could not be closed
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      const borrowedOfNonRiskyPosition = parseUnits("0.1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedOfNonRiskyPosition;
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);
      OpenPositionParams.closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), 0))];
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      await positionManager.connect(trader).openPosition(OpenPositionParams);

      await PrimexDNS.setConditionalManager(TAKE_PROFIT_STOP_LOSS_CM_TYPE, (await getContract("LimitPriceCOM")).address);

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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CLOSE_CONDITION_IS_NOT_CORRECT");
    });

    it("Should revert close by TP if first position has wrong close manager", async function () {
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, parseEther("0.5")],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      OpenPositionParams.marginParams.borrowedAmount = parseUnits("0.1", decimalsA);
      OpenPositionParams.closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), 0))];

      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      let price = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      const amountB0 = positionAmount0.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount0, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      price = wadDiv(amountB0.toString(), amountA.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);
      await PrimexDNS.setConditionalManager(TAKE_PROFIT_STOP_LOSS_CM_TYPE, (await getContract("LimitPriceCOM")).address);

      await expect(
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [1, 0],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0],
            CloseReason.BATCH_TAKE_PROFIT,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CLOSE_CONDITION_IS_NOT_CORRECT");
    });

    describe("Batch close events", function () {
      let totalPrice,
        expectedClosePosition0Event,
        expectedClosePosition1Event,
        expectedPaidProtocolFee0Event,
        expectedPaidProtocolFee1Event;
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
        const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
        const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);

        const amountOut0 = positionAmount0.mul(totalAmountOut).div(totalPositionAmount);
        const amountOut1 = positionAmount1.mul(totalAmountOut).div(totalPositionAmount);

        const feeInPaymentAsset0 = wadMul(amountOut0.toString(), feeRate.toString()).toString();
        const feeInPaymentAsset1 = wadMul(amountOut1.toString(), feeRate.toString()).toString();

        const totalAmountA = totalAmountOut.mul(multiplierA);
        totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
        totalPrice = BigNumber.from(totalPrice).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, totalPrice);

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
          amountOut: amountOut0.sub(feeInPaymentAsset0),
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
          amountOut: amountOut1.sub(feeInPaymentAsset1),
          reason: undefined,
        };

        expectedPaidProtocolFee0Event = {
          positionId: 0,
          trader: trader.address,
          paymentAsset: testTokenA.address,
          feeRateType: FeeRateType.MarginPositionClosedByKeeper,
          feeInPaymentAsset: feeInPaymentAsset0,
          feeInPmx: 0,
        };

        expectedPaidProtocolFee1Event = {
          positionId: 1,
          trader: trader.address,
          paymentAsset: testTokenA.address,
          feeRateType: FeeRateType.MarginPositionClosedByKeeper,
          feeInPaymentAsset: feeInPaymentAsset1,
          feeInPmx: 0,
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          );
        expectedClosePosition0Event.reason = CloseReason.BATCH_LIQUIDATION;
        expectedClosePosition1Event.reason = CloseReason.BATCH_LIQUIDATION;
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition1Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "PaidProtocolFee",
          await tx.wait(),
          expectedPaidProtocolFee0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "PaidProtocolFee",
          await tx.wait(),
          expectedPaidProtocolFee1Event,
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
        eventValidation(
          "PaidProtocolFee",
          await tx.wait(),
          expectedPaidProtocolFee0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "PaidProtocolFee",
          await tx.wait(),
          expectedPaidProtocolFee1Event,
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
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
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
        eventValidation(
          "PaidProtocolFee",
          await tx.wait(),
          expectedPaidProtocolFee0Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
        eventValidation(
          "PaidProtocolFee",
          await tx.wait(),
          expectedPaidProtocolFee1Event,
          await getContractAt("PositionLibrary", batchManager.address),
        );
      });
    });
  });
  describe("closeBatchPositions when protocolFee in PMX", function () {
    let snapshotId;
    let positionAmount0;
    let positionAmount1;
    let totalPositionAmount;
    let borrowedAmount, ethAddress;

    before(async function () {
      ethAddress = await priceOracle.eth();
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await testTokenA.mint(trader.address, parseUnits("200", decimalsA));
      await testTokenA.mint(lender.address, parseUnits("100", decimalsA));
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("50", decimalsA), true);
      borrowedAmount = parseUnits("30", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      const price0 = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(price0).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), BigNumber.from(limitPrice).mul(2))),
      ];
      OpenPositionParams.isProtocolFeeInPmx = true;

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      // to avoid the different price error
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amount0Out,
        path: [testTokenB.address, testTokenA.address],
      });

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      ({ positionAmount: positionAmount0 } = await positionManager.getPosition(0));
      ({ positionAmount: positionAmount1 } = await positionManager.getPosition(1));
      totalPositionAmount = positionAmount0.add(positionAmount1);
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

    it("Should close positions by SL and correct calculate fee amount in PMX ", async function () {
      await PMXToken.transfer(trader.address, parseEther("1"));
      await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const feeInPaymentAsset = wadMul(totalAmountOut.toString(), feeRate.toString()).toString();
      const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
      const feeInPaymentAssetWithDiscount = wadMul(feeInPaymentAsset.toString(), pmxDiscountMultiplier.toString()).toString();

      const feeAmountInPmx = await calculateFeeAmountInPmx(
        testTokenA.address,
        PMXToken.address,
        feeInPaymentAssetWithDiscount,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      );

      await expect(() =>
        batchManager
          .connect(liquidator)
          .closeBatchPositions(
            [0, 1],
            routesForClose,
            testTokenB.address,
            testTokenA.address,
            bucketAddress,
            [0, 0],
            CloseReason.BATCH_STOP_LOSS,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(PMXToken),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(ethAddress),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalance(PMXToken, treasury, feeAmountInPmx);
    });
    it("Closes positions, transfers fee to treasury in PMX and positionAsset when isProtocolFeeInPmx = true, but trader lacks PMX balance in vault", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10000", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const totalFeeInPaymentAsset = wadMul(totalAmountOut.toString(), feeRate.toString()).toString();

      const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
      const feeInPaymentAssetWithDiscount = wadMul(totalFeeInPaymentAsset, pmxDiscountMultiplier.toString()).toString();
      const feeAmountInPmx = await calculateFeeAmountInPmx(
        testTokenA.address,
        PMXToken.address,
        feeInPaymentAssetWithDiscount,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      );

      const pmxTraderBalance = feeAmountInPmx.div(2);
      await PMXToken.transfer(trader.address, pmxTraderBalance);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, pmxTraderBalance);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, pmxTraderBalance);

      const pmxTraderBalanceInPositionAsset = pmxTraderBalance.mul(totalFeeInPaymentAsset).div(feeAmountInPmx);
      const restFeeInPositionAsset = BigNumber.from(totalFeeInPaymentAsset).sub(pmxTraderBalanceInPositionAsset);

      await PrimexDNS.deprecateBucket("bucket1");
      const delistingDeadline = (await PrimexDNS.buckets("bucket1")).delistingDeadline;
      const txBlockTimestamp = delistingDeadline.add(1);

      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const balanceBefore = await testTokenA.balanceOf(treasury.address);
      const tx = await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BUCKET_DELISTED,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      const balanceAfter = await testTokenA.balanceOf(treasury.address);
      await expect(tx).to.changeTokenBalance(PMXToken, treasury, feeAmountInPmx.div(2));
      expect(balanceAfter).to.be.closeTo(balanceBefore.add(restFeeInPositionAsset), 2);
    });
  });
  describe("closeBatchPositions_ArbitrumPaymentModel", function () {
    let snapshotId;
    let positionAmount0;
    let positionAmount1;
    let totalAmountOut;
    let totalPositionAmount;
    let KeeperRDArbitrum, BigTimelockAdmin, l1GasPrice, baseLength;
    let borrowedAmount, ethAddress, primexPricingLibraryMock;

    before(async function () {
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
      await testTokenA.mint(lender.address, parseUnits("100", decimalsA));
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("50", decimalsA), true);
      borrowedAmount = parseUnits("30", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(swap.toString(), amountB.toString()).toString();
      const price0 = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(price0).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      ethAddress = await priceOracle.eth();
      const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
        libraries: {
          PrimexPricingLibrary: PrimexPricingLibrary.address,
        },
      });
      primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
      await primexPricingLibraryMock.deployed();

      l1GasPrice = 30e9;
      const arbGasInfoArtifact = await getArtifact("ArbGasInfoMock");
      await network.provider.send("hardhat_setCode", [ArbGasInfo, arbGasInfoArtifact.deployedBytecode]);
      const arbGasInfo = await getContractAt("ArbGasInfoMock", ArbGasInfo);
      await arbGasInfo.setL1BaseFeeEstimate(l1GasPrice);
      ({ BigTimelockAdmin } = await getAdminSigners());
      const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
      const registryAddress = (await getContract("Registry")).address;
      const KeeperRDFactory = await getContractFactory("KeeperRewardDistributor", {
        libraries: {
          PrimexPricingLibrary: PrimexPricingLibrary.address,
        },
      });

      const pmxPartInReward = await KeeperRewardDistributor.pmxPartInReward();
      const nativePartInReward = await KeeperRewardDistributor.nativePartInReward();
      const positionSizeCoefficient = await KeeperRewardDistributor.positionSizeCoefficient();
      const additionalGas = await KeeperRewardDistributor.additionalGas();
      const defaultMaxGasPrice = await KeeperRewardDistributor.defaultMaxGasPrice();
      const initParams = {
        pmx: PMXToken.address,
        pmxPartInReward: pmxPartInReward,
        nativePartInReward: nativePartInReward,
        positionSizeCoefficient: positionSizeCoefficient,
        additionalGas: additionalGas,
        oracleGasPriceTolerance: parseUnits("1", 17),
        paymentModel: PaymentModel.ARBITRUM,
        defaultMaxGasPrice: defaultMaxGasPrice,
        registry: registryAddress,
        priceOracle: priceOracle.address,
        treasury: treasury.address,
        whiteBlackList: whiteBlackList.address,
        maxGasPerPositionParams: [
          {
            actionType: KeeperActionType.Liquidation,
            config: {
              baseMaxGas1: "100000000",
              baseMaxGas2: "100000000",
              multiplier1: parseEther("100"),
              multiplier2: "0",
              inflectionPoint: "0",
            },
          },
        ],
        decreasingGasByReasonParams: [],
      };
      KeeperRDArbitrum = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      const { payload } = await encodeFunctionData("setKeeperRewardDistributor", [KeeperRDArbitrum.address], "PositionManagerExtension");
      await positionManager.connect(BigTimelockAdmin).setProtocolParamsByAdmin(payload);

      [, baseLength] = await PrimexDNS.minFeeRestrictions(CallingMethod.ClosePositionByCondition);

      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("1"), BigNumber.from(limitPrice).mul(2))),
      ];

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      // to avoid the different price error
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amount0Out,
        path: [testTokenB.address, testTokenA.address],
      });

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      ({ positionAmount: positionAmount0 } = await positionManager.getPosition(0));
      ({ positionAmount: positionAmount1 } = await positionManager.getPosition(1));
      totalPositionAmount = positionAmount0.add(positionAmount1);
      totalAmountOut = await getAmountsOut(dex, totalPositionAmount, [testTokenB.address, testTokenA.address]);
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

    it("Should liquidate positions by BUCKET_DELISTED reason and correct calculate fee when protocoleFeeInPaymentAsset < minProtocolFee", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("50", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const feePaymentAsset = wadMul(totalAmountOut.toString(), feeRate.toString()).toString();
      const feeInNativeCurrency = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenA.address,
        NATIVE_CURRENCY,
        feePaymentAsset,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(NATIVE_CURRENCY),
      );
      const numberOfPositions = 2;
      const gasPerBatch = await batchManager.gasPerBatch();
      const gasPerPosition = await batchManager.gasPerPosition();
      const estimatedGasAmount = (gasPerBatch.toNumber() / numberOfPositions + gasPerPosition.toNumber()).toString();
      const gasPrice = BigNumber.from(feeInNativeCurrency).div(estimatedGasAmount);
      const estimatedBaseLength = 64 + baseLength / numberOfPositions;
      const l1CostWei = l1GasPrice * 16 * (estimatedBaseLength + 140);

      const minFeeInNativeAsset = BigNumber.from(estimatedGasAmount).mul(gasPrice).add(l1CostWei);
      const feeInNativeAsset = minFeeInNativeAsset.mul(2);

      const feeInPaymentAsset = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        testTokenA.address,
        feeInNativeAsset,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      await PrimexDNS.deprecateBucket("bucket1");
      const delistingDeadline = (await PrimexDNS.buckets("bucket1")).delistingDeadline;
      const txBlockTimestamp = delistingDeadline.add(1);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const balanceBefore = await testTokenA.balanceOf(treasury.address);
      await batchManager
        .connect(liquidator)
        .closeBatchPositions(
          [0, 1],
          routesForClose,
          testTokenB.address,
          testTokenA.address,
          bucketAddress,
          [],
          CloseReason.BUCKET_DELISTED,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
          { gasPrice: gasPrice },
        );
      const balanceAfter = await testTokenA.balanceOf(treasury.address);
      expect(balanceAfter).to.be.closeTo(balanceBefore.add(feeInPaymentAsset), 2);
    });
    it("Should close positions by SL and correct calculate fee amount when protocoleFeeInPaymentAsset < minProtocolFee", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("50", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const totalAmountB = totalPositionAmount.mul(multiplierB);
      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const feePaymentAsset = wadMul(totalAmountOut.toString(), feeRate.toString()).toString();
      const feeInNativeCurrency = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        testTokenA.address,
        NATIVE_CURRENCY,
        feePaymentAsset,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(NATIVE_CURRENCY),
      );
      const numberOfPositions = 2;
      const gasPerBatch = await batchManager.gasPerBatch();
      const gasPerPosition = await batchManager.gasPerPosition();
      const estimatedGasAmount = (gasPerBatch.toNumber() / numberOfPositions + gasPerPosition.toNumber()).toString();
      const gasPrice = BigNumber.from(feeInNativeCurrency).div(estimatedGasAmount);
      const estimatedBaseLength = 64 + baseLength / numberOfPositions;
      const l1CostWei = l1GasPrice * 16 * (estimatedBaseLength + 140);
      const minFeeInNativeAsset = BigNumber.from(estimatedGasAmount).mul(gasPrice).add(l1CostWei);
      const feeInNativeAsset = minFeeInNativeAsset.mul(2);

      const totalAmountA = totalAmountOut.mul(multiplierA);
      const totalPrice = wadDiv(totalAmountB.toString(), totalAmountA.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(totalPrice).div(USD_MULTIPLIER));

      // check that all the values after mint are the same
      const { oldBalance: oldBalanceBefore } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupplyBefore = await debtTokenA.scaledTotalSupply();
      const balanceOfBefore = await debtTokenA.scaledBalanceOf(trader.address);

      expect(oldBalanceBefore).to.be.equal(totalSupplyBefore).to.be.equal(balanceOfBefore);
      const balanceBefore = await testTokenA.balanceOf(treasury.address);
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
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(PMXToken),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(ethAddress),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
          { gasPrice: gasPrice },
        );
      const feeInPaymentAsset = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        testTokenA.address,
        feeInNativeAsset,
        priceOracle.address,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const balanceAfter = await testTokenA.balanceOf(treasury.address);
      expect(balanceAfter).to.be.closeTo(balanceBefore.add(feeInPaymentAsset), 2);

      const { oldBalance } = await activityRewardDistributor.getUserInfoFromBucket(bucketAddress, 1, trader.address);
      const totalSupply = await debtTokenA.scaledTotalSupply();
      const balanceOfBeforeAfter = await debtTokenA.scaledBalanceOf(trader.address);
      expect(oldBalance).to.be.equal(totalSupply).to.be.equal(balanceOfBeforeAfter).to.be.equal(Zero);
    });
  });
});
