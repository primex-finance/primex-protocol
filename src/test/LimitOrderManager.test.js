// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  upgrades,
  ethers: {
    BigNumber,
    provider,
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits, getAddress, arrayify, defaultAbiCoder },
    constants: { MaxUint256, NegativeOne, AddressZero },
  },
  deployments: { fixture },
} = require("hardhat");

const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  NATIVE_CURRENCY,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  BAR_CALC_PARAMS_DECODE,
  FeeRateType,
  USD_DECIMALS,
  USD_MULTIPLIER,
  UpdatePullOracle,
} = require("./utils/constants");
const { wadDiv, wadMul, rayDiv, calculateMaxAssetLeverage } = require("./utils/math");
const {
  getAmountsOut,
  addLiquidity,
  getPair,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  getSingleMegaRoute,
  getMegaRoutes,
  getGas,
} = require("./utils/dexOperations");
const { calculateFeeInPaymentAsset, calculateFeeAmountInPmx } = require("./utils/protocolUtils");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");

const { eventValidation, parseArguments } = require("./utils/eventValidation");
const { deployMockReserve, deployMockERC20, deployMockSwapManager } = require("./utils/waffleMocks");
const {
  getLimitPriceParams,
  getTakeProfitStopLossParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("./utils/conditionParams");
const { getImpersonateSigner } = require("./utils/hardhatUtils");
const {
  setupUsdOraclesForToken,
  setOraclePrice,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
} = require("./utils/oracleUtils");

const { barCalcParams } = require("./utils/defaultBarCalcParams");
const { getAdminSigners } = require("./utils/hardhatUtils");

process.env.TEST = true;

describe("LimitOrderManager", function () {
  let dex,
    dex2,
    limitOrderManager,
    limitOrderManagerFactory,
    positionManager,
    traderBalanceVault,
    whiteBlackList,
    testTokenA,
    testTokenB,
    bucket,
    testTokenX,
    PrimexDNS,
    bestDexLens,
    primexLens,
    PMXToken,
    Treasury,
    registry,
    ancillaryDexData,
    primexPricingLibrary,
    primexPricingLibraryMock,
    tokenTransfersLibrary,
    limitOrderLibrary,
    ancillaryDexData2,
    firstAssetMegaRoutes,
    decimalsA,
    decimalsB,
    decimalsX,
    interestRateStrategy,
    swapManager,
    mockContract;
  let pair;
  let bucketAddress, newBucketAddress;
  let tokenWETH;
  let priceOracle;
  let trader, lender, liquidator, BigTimelockAdmin;
  let snapshotIdBase;
  let mockReserve;
  let deployer;
  let limitPriceCOM, takeProfitStopLossCCM;
  let multiplierA, multiplierB;
  let ErrorsLibrary;
  let leverageTolerance;
  before(async function () {
    await fixture(["Test"]);

    // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
    await upgrades.silenceWarnings();

    ({ deployer, trader, lender, liquidator } = await getNamedSigners());
    ({ BigTimelockAdmin } = await getAdminSigners());
    traderBalanceVault = await getContract("TraderBalanceVault");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    bestDexLens = await getContract("BestDexLens");
    primexLens = await getContract("PrimexLens");
    positionManager = await getContract("PositionManager");
    limitOrderManager = await getContract("LimitOrderManager");
    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    registry = await getContract("Registry");
    PMXToken = await getContract("EPMXToken");
    Treasury = await getContract("Treasury");
    whiteBlackList = await getContract("WhiteBlackList");
    ErrorsLibrary = await getContract("Errors");
    interestRateStrategy = await getContract("InterestRateStrategy");
    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);
    priceOracle = await getContract("PriceOracle");

    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();

    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    limitOrderLibrary = await getContract("LimitOrderLibrary");
    takeProfitStopLossCCM = await getContract("TakeProfitStopLossCCM");
    limitPriceCOM = await getContract("LimitPriceCOM");
    swapManager = await getContract("SwapManager");
    limitOrderManagerFactory = await getContractFactory("LimitOrderManager", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
        LimitOrderLibrary: limitOrderLibrary.address,
      },
    });

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }
    ancillaryDexData = await getAncillaryDexData({ dex });
    ancillaryDexData2 = await getAncillaryDexData({ dex: dex2 });
    checkIsDexSupported(dex);
    firstAssetMegaRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    const pairAddress = await getPair(dex, testTokenA.address, testTokenB.address);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);
    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    decimalsX = await testTokenX.decimals();

    await run("deploy:ERC20Mock", {
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: "18",
    });
    tokenWETH = await getContract("Wrapped Ether");

    await setupUsdOraclesForTokens(testTokenA, testTokenB, parseUnits("1", USD_DECIMALS));
    await setupUsdOraclesForTokens(testTokenA, tokenWETH, parseUnits("1", USD_DECIMALS));

    await setupUsdOraclesForTokens(testTokenB, testTokenX, parseUnits("1", USD_DECIMALS));

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), parseUnits("0.3", USD_DECIMALS));
    await setupUsdOraclesForTokens(testTokenB, await priceOracle.eth(), parseUnits("0.3", USD_DECIMALS));
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), parseUnits("0.3", USD_DECIMALS));

    await setupUsdOraclesForTokens(testTokenA, PMXToken, parseUnits("0.2", USD_DECIMALS));
    await setupUsdOraclesForTokens(testTokenX, PMXToken, parseUnits("0.2", USD_DECIMALS));
    await setupUsdOraclesForTokens(await priceOracle.eth(), PMXToken, parseUnits("0.666", USD_DECIMALS));

    mockReserve = await deployMockReserve(deployer);

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    leverageTolerance = parseEther("0.01");
    await PrimexDNS.setLeverageTolerance(leverageTolerance);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("initialize", function () {
    let snapshotId;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should initialize with correct values", async function () {
      expect(await limitOrderManager.primexDNS()).to.equal(PrimexDNS.address);
      expect(await limitOrderManager.registry()).to.equal(registry.address);
      expect(await limitOrderManager.pm()).to.equal(positionManager.address);
      expect(await limitOrderManager.traderBalanceVault()).to.equal(traderBalanceVault.address);
      expect(await limitOrderManager.swapManager()).to.equal(swapManager.address);
    });

    it("Should revert when initialized with wrong primexDNS address", async function () {
      await expect(
        upgrades.deployProxy(
          limitOrderManagerFactory,
          [
            registry.address,
            registry.address,
            positionManager.address,
            traderBalanceVault.address,
            swapManager.address,
            whiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong registry address", async function () {
      await expect(
        upgrades.deployProxy(
          limitOrderManagerFactory,
          [
            PrimexDNS.address,
            PrimexDNS.address,
            positionManager.address,
            traderBalanceVault.address,
            swapManager.address,
            whiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong positionManager address", async function () {
      await expect(
        upgrades.deployProxy(
          limitOrderManagerFactory,
          [PrimexDNS.address, registry.address, registry.address, traderBalanceVault.address, swapManager.address, whiteBlackList.address],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong traderBalanceVault address", async function () {
      await expect(
        upgrades.deployProxy(
          limitOrderManagerFactory,
          [PrimexDNS.address, registry.address, positionManager.address, registry.address, swapManager.address, whiteBlackList.address],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong swapManager address", async function () {
      await expect(
        upgrades.deployProxy(
          limitOrderManagerFactory,
          [
            PrimexDNS.address,
            registry.address,
            positionManager.address,
            traderBalanceVault.address,
            registry.address,
            whiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("sets", function () {
    let snapshotId;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
  });

  describe("Limit Order", function () {
    let snapshotId, leverage, borrowedAmount, depositAmount, snapshotIdBase2;
    before(async function () {
      leverage = parseEther("2");
      depositAmount = parseUnits("15", decimalsA);
      borrowedAmount = wadMul(depositAmount.toString(), leverage.sub(parseEther("1")).toString()).toString();
      await PMXToken.transfer(trader.address, parseEther("1"));
      const lenderAmount = parseUnits("50", decimalsA);
      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
      snapshotIdBase2 = await network.provider.request({
        method: "evm_snapshot",
        params: [],
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
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    describe("CreateLimitOrder", function () {
      it("Should revert when the limitOrderManager is paused", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await limitOrderManager.pause();
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWith("Pausable: paused");
      });

      it("Should revert when the deadline is less than the current timestamp", async function () {
        const takeDepositFromWallet = false;

        const latestTimeStamp = (await provider.getBlock("latest")).timestamp;
        const deadline = latestTimeStamp + 10;
        await network.provider.send("evm_setNextBlockTimestamp", [deadline]);

        await expect(
          limitOrderManager.connect(mockContract).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_DEADLINE");
      });

      it("Should revert when the msg.sender is on the blacklist", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await whiteBlackList.addAddressToBlacklist(mockContract.address);
        await expect(
          limitOrderManager.connect(mockContract).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
      });

      it("Should revert when bucket hasn't been launched yet", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;

        const LiquidityMiningRewardDistributor = await getContract("LiquidityMiningRewardDistributor");
        await run("deploy:Bucket", {
          nameBucket: "BucketWithLiquidityMining",
          assets: `["${testTokenB.address}"]`,
          pairVolatilities: "['100000000000000000']",
          feeBuffer: "1000100000000000000", // 1.0001
          withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
          reserveRate: "100000000000000000", // 0.1 - 10%,
          underlyingAsset: testTokenA.address,
          liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
          liquidityMiningAmount: parseUnits("100", decimalsA).toString(),
          liquidityMiningDeadline: (deadline + 24 * 60 * 60).toFixed(),
          stabilizationDuration: (60 * 60).toFixed(), // 1 hour
          pmxRewardAmount: parseEther("2000").toString(),
          estimatedBar: "100000000000000000000000000", // 0.1 in ray
          estimatedLar: "70000000000000000000000000", // 0.07 in ray
          maxAmountPerUser: MaxUint256.toString(),
          barCalcParams: JSON.stringify(barCalcParams),
          maxTotalDeposit: MaxUint256.toString(),
        });

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "BucketWithLiquidityMining",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_NOT_LAUNCHED");
      });

      it("Should revert when create limit order with not allowed token (testTokenX)", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenX.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
      });

      it("Should revert when create limit order when leverage >= maxLeverage of the bucket", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const feeBuffer = await bucket.feeBuffer();
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const oracleTolerableLimitAB = await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenB.address);
        const oracleTolerableLimitBA = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
        const maintenanceBuffer = await positionManager.maintenanceBuffer();
        const securityBuffer = await positionManager.securityBuffer();
        const feeRate = parseEther("0.003");
        const maxLeverage = calculateMaxAssetLeverage(
          feeBuffer,
          maintenanceBuffer,
          securityBuffer,
          pairPriceDrop,
          oracleTolerableLimitAB,
          oracleTolerableLimitBA,
          feeRate,
        );
        const leverage = maxLeverage.plus("1").toString();

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(BigNumber.from(leverage).div(multiplierA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_EXCEEDS_MAX_LEVERAGE");
      });

      it("Should revert create limit order when leverage == WAD for margin order", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const leverage = parseEther("1");

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(BigNumber.from(leverage).div(multiplierA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_MUST_BE_MORE_THAN_1");
      });

      it("Should create 'LimitOrder' and transfer testTokenA from trader to 'TraderBalanceVault'", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await expect(() =>
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(leverage.div(multiplierA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.changeTokenBalances(testTokenA, [trader, traderBalanceVault], [depositAmount.mul(NegativeOne), depositAmount]);

        const { limitOrdersWithConditions } = await primexLens.getLimitOrdersWithConditions(limitOrderManager.address, 0, 10);
        expect(await limitOrderManager.getOrdersLength()).to.equal(1);
        expect(limitOrdersWithConditions.length).to.be.equal(1);
        expect(await limitOrderManager.ordersId()).to.be.equal(1);
        expect(await limitOrderManager.orderIndexes(limitOrdersWithConditions[0].limitOrderData.id)).to.be.equal(0);
      });

      it("Should create 'LimitOrder' when takeDepositFromWallet is false", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const exchangeRate = parseUnits("1", decimalsA);

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeRate))],
          closeConditions: [],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
      });

      it("Should create 'LimitOrder' when takeDepositFromWallet is false, isProtocolFeeInPmx is true", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const isProtocolFeeInPmx = true;
        const exchangeRate = parseUnits("1", decimalsA);
        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          isProtocolFeeInPmx: isProtocolFeeInPmx,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeRate))],
          closeConditions: [],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
      });

      it("Should create 'LimitOrder' with the correct variables", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const exchangeRate = parseUnits("1", decimalsA);
        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          exchangeRate,
          leverage,
        );
        const slPrice = liquidationPrice.add(1).mul(multiplierA);
        const tpPrice = parseEther("2");

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeRate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const expectedOrder = {
          bucket: (await PrimexDNS.buckets("bucket1")).bucketAddress,
          positionAsset: testTokenB.address,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          feeToken: testTokenB.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: 1,
          leverage: parseEther("2"),
          shouldOpenPosition: true,
          createdAt: (await provider.getBlock("latest")).timestamp,
          updatedConditionsAt: (await provider.getBlock("latest")).timestamp,
          extraParams: "0x",
        };
        const order = await limitOrderManager.getOrder(1);
        parseArguments(expectedOrder, order);

        const openCondition = (await limitOrderManager.getOpenConditions(1))[0];
        expect(openCondition.params).to.equal(getLimitPriceParams(exchangeRate));
      });

      it("Should create 'LimitOrder' with the correct variables when isProtocolFeeInPmx is true", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const exchangeRate = parseUnits("1", decimalsA);

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          isProtocolFeeInPmx: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeRate))],
          closeConditions: [],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const expectedOrder = {
          bucket: (await PrimexDNS.buckets("bucket1")).bucketAddress,
          positionAsset: testTokenB.address,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: 1,
          leverage: parseEther("2"),
          shouldOpenPosition: true,
          createdAt: (await provider.getBlock("latest")).timestamp,
          updatedConditionsAt: (await provider.getBlock("latest")).timestamp,
          extraParams: "0x",
        };
        const order = await limitOrderManager.getOrder(1);

        parseArguments(expectedOrder, order);
      });

      it("Should open limit order and throw event", async function () {
        const deadline = new Date().getTime() + 600;
        const orderId = 1;
        const takeDepositFromWallet = false;
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenA.address,
        );
        expect(availableBefore).to.equal(depositAmount);
        expect(lockedBefore).to.equal(0);
        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), 0))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const createLimitOrderEvent = await txCreateLimitOrder.wait();
        const orderObject = {
          bucket: (await limitOrderManager.getOrder(orderId)).bucket,
          positionAsset: testTokenB.address,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          feeToken: testTokenB.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: orderId,
          leverage: leverage,
          shouldOpenPosition: true,
          createdAt: (await provider.getBlock("latest")).timestamp,
          updatedConditionsAt: (await provider.getBlock("latest")).timestamp,
          extraParams: "0x",
        };

        const expectedArguments = [
          orderId,
          trader.address,
          orderObject,
          [[LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA))]],
          [[TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), 0)]],
        ];

        eventValidation("CreateLimitOrder", createLimitOrderEvent, expectedArguments);

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenA.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(depositAmount);
      });

      it("Should create limit order with sl price > liquidationPrice (sl amount >= liquidation amount)", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const limitPrice = parseUnits("2", decimalsA);
        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          limitPrice,
          leverage,
        );

        const liquidationPriceInWadDecimals = liquidationPrice.mul(multiplierA);
        expect(
          await limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [
              getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, liquidationPriceInWadDecimals.add("1"))),
            ],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.emit(limitOrderManager, "CreateLimitOrder");
      });

      it("Should revert when created with no open conditions", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAmount: depositAmount,
            depositAsset: testTokenA.address,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_HAVE_OPEN_CONDITIONS");
      });

      it("Should revert when created with shouldOpenPosition=false and not empty close conditions", async function () {
        const deadline = new Date().getTime() + 600;

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: true,
            leverage: parseEther("1"),
            shouldOpenPosition: false,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, 1))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_NOT_HAVE_CLOSE_CONDITIONS");
      });

      it("Should revert when openingManagerAddresses has duplicates", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAmount: depositAmount,
            depositAsset: testTokenA.address,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [
              getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(leverage.div(multiplierA))),
              getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(leverage.div(multiplierA))),
            ],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_NOT_HAVE_DUPLICATES");
      });

      it("Should revert when openingManagerAddresses is not COM", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAmount: depositAmount,
            depositAsset: testTokenA.address,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getLimitPriceParams(leverage.div(multiplierA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_BE_COM");
      });

      it("Should revert when closingManagerAddresses is not CCM", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAmount: depositAmount,
            depositAsset: testTokenA.address,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [],
            closeConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getTakeProfitStopLossParams(0, 1))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_BE_CCM");
      });
    });

    describe("CreateLimitOrder with minPositionSize", function () {
      it("Should revert when position size < minPositionSize", async function () {
        const gasPrice = parseUnits("1000", "gwei");
        const depositAmount = parseUnits("0.01", decimalsA);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await expect(
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "bucket1",
              depositAsset: testTokenA.address,
              depositAmount: depositAmount,
              positionAsset: testTokenB.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              leverage: leverage,
              shouldOpenPosition: true,
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
              closeConditions: [],
              isProtocolFeeInPmx: false,
              nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
              pullOracleData: [],
              pullOracleTypes: [],
            },
            { gasPrice },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
      it("Should create limit order when position size >= minPositionSize", async function () {
        const depositAmount = parseUnits("3", decimalsA);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
            closeConditions: [],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
            borrowedAmount,
          }),
        ).to.emit(limitOrderManager, "CreateLimitOrder");
      });
      it("Should revert openPositionByOrder when position size < minPositionSize", async function () {
        const gasPrice = parseUnits("1000", "gwei");
        const depositAmount = parseUnits("0.01", decimalsA);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
          closeConditions: [],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderId = await limitOrderManager.ordersId();
        await setOraclePrice(testTokenA, tokenWETH, parseUnits("1", USD_DECIMALS).div("2"));

        const additionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, [], []);
        await expect(
          limitOrderManager.openPositionByOrder(
            {
              orderId: orderId,
              conditionIndex: 0,
              comAdditionalParams: additionalParams,
              firstAssetMegaRoutes: firstAssetMegaRoutes,
              depositInThirdAssetMegaRoutes: [],
              keeper: liquidator.address,
              firstAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
              thirdAssetOracleData: [],
              depositSoldAssetOracleData: [],
              nativePmxOracleData: await getEncodedChainlinkRouteViaUsd(PMXToken),
              positionNativeAssetOracleData: await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()),
              nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
              pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
              positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
              nativeSoldAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenA),
              pullOracleData: [],
              pullOracleTypes: [],
              borrowedAmount: wadMul(depositAmount.toString(), leverage.sub(parseEther("1")).toString()).toString(),
            },
            { gasPrice },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
    });

    describe("cancelLimitOrder", function () {
      let limitPrice, leverage, stopLossPrice, takeProfitPrice, takeDepositFromWallet, deadline;
      before(async function () {
        deadline = new Date().getTime() + 600;
        takeDepositFromWallet = true;
        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount.mul("3"));
        limitPrice = parseUnits("1", decimalsA);
        leverage = parseEther("2");
        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          limitPrice,
          leverage,
        );
        const difference = limitPrice.sub(liquidationPrice).div(2);
        stopLossPrice = limitPrice.sub(difference).mul(multiplierA);
        takeProfitPrice = limitPrice.add(difference).mul(multiplierA);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
      });

      describe("cancelExpiredLimitOrders", function () {
        it("Shouldn't revert cancelExpiredLimitOrders when order does not exist", async function () {
          expect(await limitOrderManager.connect(lender).cancelExpiredLimitOrders([5, 6, 7, 8]));
        });

        it("Shouldn't revert cancelExpiredLimitOrders when order is not expired, just the execution proceeds to the next iteration of the loop", async function () {
          // open a second order
          await limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          });
          const traderOrdersLengthBefore = await limitOrderManager.getTraderOrdersLength(trader.address);
          await limitOrderManager.cancelExpiredLimitOrders([1, 2]);
          const traderOrdersLengthAfter = await limitOrderManager.getTraderOrdersLength(trader.address);
          expect(traderOrdersLengthBefore).to.be.equal(traderOrdersLengthAfter);
        });

        it("Should cancelExpiredLimitOrders when orders are expired and emit correct events", async function () {
          const deadlineForSecondOrder = deadline + 600;
          // open a second order
          await limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadlineForSecondOrder,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          });

          // create a third order
          await limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          });

          const traderOrdersLengthBefore = await limitOrderManager.getTraderOrdersLength(trader.address);

          // deadline < current timestamp for orders id = 1 and 3
          await network.provider.send("evm_setNextBlockTimestamp", [deadline + 1]);
          await provider.send("evm_mine");

          const { lockedBalance: lockedBeforeTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
          const { availableBalance: availableBeforeTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);

          // a fourth order doesn't exist and a second order is not expired
          const txCancelExpiredLimitOrders = await limitOrderManager.connect(lender).cancelExpiredLimitOrders([1, 2, 3, 4]);

          const traderOrdersLengthAfter = await limitOrderManager.getTraderOrdersLength(trader.address);

          const { lockedBalance: lockedAfterTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
          const { availableBalance: availableAfterTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
          // check deposit
          expect(lockedAfterTrader).to.be.equal(lockedBeforeTrader.sub(depositAmount.mul("2")));
          expect(availableAfterTrader).to.be.equal(availableBeforeTrader.add(depositAmount.mul("2")));

          const closeReasonCancelled = 3;
          const expectedArguments = {
            orderId: 1,
            trader: trader.address,
            closedBy: lender.address,
            reason: closeReasonCancelled,
            positionId: 0,
            bucket: "bucket1",
            borrowedAsset: testTokenA.address,
            positionAsset: testTokenB.address,
            leverage: leverage,
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
          };

          const expectedArguments2 = {
            orderId: 3,
            trader: trader.address,
            closedBy: lender.address,
            reason: closeReasonCancelled,
            positionId: 0,
            bucket: "bucket1",
            borrowedAsset: testTokenA.address,
            positionAsset: testTokenB.address,
            leverage: leverage,
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
          };
          eventValidation("CloseLimitOrder", await txCancelExpiredLimitOrders.wait(), expectedArguments);
          eventValidation("CloseLimitOrder", await txCancelExpiredLimitOrders.wait(), expectedArguments2);
          expect(traderOrdersLengthBefore).to.be.equal(3);
          expect(traderOrdersLengthAfter).to.be.equal(1);
        });

        it("Should cancelExpiredLimitOrders when now is the time after delisting", async function () {
          // open a second order
          await limitOrderManager.connect(trader).createLimitOrder({
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          });

          await PrimexDNS.deprecateBucket("bucket1");
          await network.provider.send("evm_increaseTime", [
            (
              await PrimexDNS.delistingDelay()
            )
              .add(await PrimexDNS.adminWithdrawalDelay())
              .add("1")
              .toNumber(),
          ]);
          const traderOrdersLengthBefore = await limitOrderManager.getTraderOrdersLength(trader.address);

          const { lockedBalance: lockedBeforeTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
          const { availableBalance: availableBeforeTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);

          // a third order doesn't exist
          await limitOrderManager.connect(lender).cancelExpiredLimitOrders([1, 2, 3]);

          const { lockedBalance: lockedAfterTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
          const { availableBalance: availableAfterTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
          const traderOrdersLengthAfter = await limitOrderManager.getTraderOrdersLength(trader.address);

          // check deposit
          expect(lockedAfterTrader).to.be.equal(lockedBeforeTrader.sub(depositAmount.mul("2")));
          expect(availableAfterTrader).to.be.equal(availableBeforeTrader.add(depositAmount.mul("2")));

          expect(traderOrdersLengthBefore).to.be.equal(2);
          expect(traderOrdersLengthAfter).to.be.equal(0);
        });
      });

      it("Should revert when the msg.sender is on the blacklist", async function () {
        await whiteBlackList.addAddressToBlacklist(mockContract.address);
        await expect(limitOrderManager.connect(mockContract).cancelLimitOrder(1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "SENDER_IS_BLACKLISTED",
        );
      });
      it("Should revert when order does not exist", async function () {
        await expect(limitOrderManager.connect(trader).cancelLimitOrder(5)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_DOES_NOT_EXIST",
        );
      });
      it("Should revert when there are no any open orders", async function () {
        expect(await limitOrderManager.ordersId()).to.be.equal(1);
        await limitOrderManager.connect(trader).cancelLimitOrder(1);
        // the array of orders is empty
        await expect(limitOrderManager.connect(trader).cancelLimitOrder(1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_DOES_NOT_EXIST",
        );
      });
      it("Should revert when caller is not the trader", async function () {
        await expect(limitOrderManager.connect(liquidator).cancelLimitOrder(1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "CALLER_IS_NOT_TRADER",
        );
      });
      it("Should cancel the order and throw correct event", async function () {
        // creating a second order (id = 2)
        const deadline = new Date().getTime() + 600;
        await testTokenA.connect(lender).approve(limitOrderManager.address, depositAmount);
        await limitOrderManager.connect(lender).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), limitPrice.sub(1).mul(multiplierA))),
          ],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const orderId = 1;

        const txCloseLimitOrder = await limitOrderManager.connect(trader).cancelLimitOrder(orderId);
        const closeReasonCancelled = 3;
        const expectedArguments = {
          orderId: orderId,
          trader: trader.address,
          closedBy: trader.address,
          reason: closeReasonCancelled,
          positionId: 0,
          bucket: "bucket1",
          borrowedAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          leverage: leverage,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
        };

        eventValidation("CloseLimitOrder", await txCloseLimitOrder.wait(), expectedArguments);

        const secondOrderIndex = await limitOrderManager.orderIndexes(2);
        expect(secondOrderIndex).to.equal(0);

        const { limitOrdersWithConditions } = await primexLens.getLimitOrdersWithConditions(limitOrderManager.address, 0, 10);
        expect(limitOrdersWithConditions[0].limitOrderData.id).to.equal(2);
        expect(limitOrdersWithConditions[0].limitOrderData.trader).to.equal(lender.address);
        expect(limitOrdersWithConditions.length).to.be.equal(1);
      });

      it("Should cancel the order and unlock trader deposit in traderBalanceVault", async function () {
        // creating a second order (id = 2)
        const deadline = new Date().getTime() + 600;
        await testTokenA.connect(lender).approve(limitOrderManager.address, depositAmount);
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          lender.address,
          testTokenA.address,
        );

        expect(availableBefore).to.equal(0); // takeDepositFromWallet=true
        expect(lockedBefore).to.equal(0);
        const limitPrice = parseUnits("1", decimalsA);

        await limitOrderManager.connect(lender).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), limitPrice.sub(1).mul(multiplierA))),
          ],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          lender.address,
          testTokenA.address,
        );

        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(depositAmount);
        const orderId = 2;

        await limitOrderManager.connect(lender).cancelLimitOrder(orderId);

        const { availableBalance: availableAfterCancel, lockedBalance: lockedAfterCancel } = await traderBalanceVault.balances(
          lender.address,
          testTokenA.address,
        );

        expect(availableAfterCancel).to.equal(depositAmount);
        expect(lockedAfterCancel).to.equal(0);
      });
    });

    describe("openPositionByOrder", function () {
      let orderId, leverage, borrowedAmount, slPrice, tpPrice, lockedBeforeAll, limitPrice, defaultAdditionalParams;
      let amountAIn, amountBOut;
      let firstAssetOracleData,
        thirdAssetOracleData,
        depositSoldAssetOracleData,
        nativePmxOracleData,
        positionNativeAssetOracleData,
        nativePositionAssetOracleData,
        pmxPositionAssetOracleData,
        positionUsdOracleData,
        nativeSoldAssetOracleData,
        pullOracleData,
        pullOracleTypes;
      let openPositionParams;

      before(async function () {
        firstAssetOracleData = await getEncodedChainlinkRouteViaUsd(testTokenB);
        thirdAssetOracleData = [];
        depositSoldAssetOracleData = [];
        nativePmxOracleData = await getEncodedChainlinkRouteViaUsd(PMXToken);
        positionNativeAssetOracleData = await getEncodedChainlinkRouteViaUsd(await priceOracle.eth());
        nativePositionAssetOracleData = await getEncodedChainlinkRouteViaUsd(testTokenB);
        pmxPositionAssetOracleData = await getEncodedChainlinkRouteViaUsd(testTokenB);
        positionUsdOracleData = getEncodedChainlinkRouteToUsd();
        nativeSoldAssetOracleData = await getEncodedChainlinkRouteViaUsd(testTokenA);
        pullOracleData = [];
        pullOracleTypes = [];

        leverage = parseEther("2");
        const lenderAmount = parseUnits("50", decimalsA);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
        await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);

        const { lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        lockedBeforeAll = lockedBalance;
        amountAIn = wadMul(depositAmount.toString(), leverage.toString()).toString();

        amountBOut = await getAmountsOut(dex, amountAIn, [testTokenA.address, testTokenB.address]);
        const amountBOutInWadDecimals = amountBOut.mul(multiplierB);
        const amountAInWadDecimals = BigNumber.from(amountAIn).mul(multiplierA);
        limitPrice = BigNumber.from(wadDiv(amountAInWadDecimals.toString(), amountBOutInWadDecimals.toString()).toString());
        limitPrice = limitPrice.div(multiplierA);
        await setOraclePrice(
          testTokenA,
          testTokenB,
          BigNumber.from(wadDiv(amountBOutInWadDecimals.toString(), amountAInWadDecimals.toString()).toString()).div(USD_MULTIPLIER),
        );

        borrowedAmount = wadMul(depositAmount.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const liquidationPrice = await primexPricingLibrary.getLiquidationPrice(
          bucketAddress,
          testTokenB.address,
          amountBOut,
          borrowedAmount,
          PrimexDNS.address,
        );

        const difference = limitPrice.sub(liquidationPrice).div(2);
        slPrice = limitPrice.sub(difference).mul(multiplierA);
        tpPrice = limitPrice.add(difference).mul(multiplierA);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        orderId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, [], []);
      });
      beforeEach(async function () {
        openPositionParams = {
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData,
          thirdAssetOracleData,
          depositSoldAssetOracleData,
          nativePmxOracleData,
          positionNativeAssetOracleData,
          nativePositionAssetOracleData,
          pmxPositionAssetOracleData,
          positionUsdOracleData,
          nativeSoldAssetOracleData,
          pullOracleData,
          pullOracleTypes,
          borrowedAmount,
        };
      });
      after(async function () {
        await network.provider.request({
          method: "evm_revert",
          params: [snapshotIdBase2],
        });
        snapshotIdBase2 = await network.provider.request({
          method: "evm_snapshot",
          params: [],
        });
      });

      it("Should revert when the msg.sender is on the blacklist", async function () {
        await whiteBlackList.addAddressToBlacklist(mockContract.address);
        await expect(
          limitOrderManager.connect(mockContract).openPositionByOrder({ ...openPositionParams, orderId: 10 }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_DOES_NOT_EXIST");
      });
      it("Should revert when the limitOrderManager is paused", async function () {
        await limitOrderManager.pause();
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.be.revertedWith("Pausable: paused");
      });
      it("Should revert when the positionManager is paused", async function () {
        await positionManager.pause();
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.be.revertedWith("Pausable: paused");
      });
      it("Should revert when the order does not exist", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
            orderId: 10,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_DOES_NOT_EXIST");
      });

      it("Should revert when the bucket is not active", async function () {
        await PrimexDNS.deprecateBucket("bucket1");
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "BUCKET_IS_NOT_ACTIVE",
        );
      });

      it("Should revert openPositionByOrder when positionAsset isn't allowed", async function () {
        await bucket.removeAsset(testTokenB.address);
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ASSET_IS_NOT_SUPPORTED",
        );
      });

      it("Should revert openPositionByOrder when firstAssetMegaRoutes is empty list", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
            firstAssetMegaRoutes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should revert openPositionByOrder when depositInThirdAssetRoutes is not empty list and depositAsset is borrowedAsset", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
            depositInThirdAssetMegaRoutes: firstAssetMegaRoutes,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0");
      });

      it("Should revert when the order price isn't reached", async function () {
        await setOraclePrice(testTokenB, testTokenA, limitPrice.div(USD_MULTIPLIER).mul("2"));
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseUnits("1", decimalsA).toString(),
          path: [testTokenA.address, testTokenB.address],
        });
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_CAN_NOT_BE_FILLED",
        );
      });

      it("Should revert when conditionIndex index is out of bounds", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
            conditionIndex: 10,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "CONDITION_INDEX_IS_OUT_OF_BOUNDS");
      });

      it("Should revert when keeper address is zero", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
            keeper: AddressZero,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_IS_ZERO");
      });
      it("Should revert when the actual leverage is different from order's leverage", async function () {
        await PrimexDNS.setLeverageTolerance(0);
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_TOLERANCE_EXCEEDED");
      });
      it("Should revert when depositAsset is the sold asset and the borrowedAmount is incorrect", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
            borrowedAmount: BigNumber.from(borrowedAmount).add("1"),
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_BORROWED_AMOUNT");
      });

      it("Should create position by order with stopLoss=0 takeProfit=0", async function () {
        depositAmount = parseUnits("15", decimalsA);
        leverage = parseEther("2");

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenA.mint(trader.address, depositAmount);
        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        const slPrice = 0;
        const tpPrice = 0;

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const orderId = await limitOrderManager.ordersId();

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          ...openPositionParams,
          orderId: orderId,
        });
      });

      it("Should create position by order and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
        await expect(() => limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.changeTokenBalances(
          testTokenA,
          [bucket, pair],
          [
            wadMul(depositAmount.toString(), leverage.sub(parseEther("1")).toString())
              .multipliedBy(NegativeOne.toString())
              .toString(),
            wadMul(depositAmount.toString(), leverage.toString()).toString(),
          ],
        );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });
      it("Should revert openPositionByOrder if POSITION_SIZE_EXCEEDED", async function () {
        const { payload } = await encodeFunctionData(
          "setMaxPositionSize",
          [testTokenA.address, testTokenB.address, 0, 0],
          "PositionManagerExtension",
        );
        await positionManager.setProtocolParamsByAdmin(payload);
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "POSITION_SIZE_EXCEEDED",
        );
      });
      it("Should update pyth oracle via  createLimitOrder function", async function () {
        const tokenAID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
        const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
        const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
        const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b4";
        const pyth = await getContract("MockPyth");

        await priceOracle.updatePythPairId(
          [testTokenA.address, testTokenB.address, await priceOracle.eth(), PMXToken.address],
          [tokenAID, tokenBID, nativeID, PMXID],
        );
        // price in 10**8
        const expo = -8;
        const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

        const timeStamp = (await provider.getBlock("latest")).timestamp;
        const updateDataTokenA = await pyth.createPriceFeedUpdateData(
          tokenAID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataTokenB = await pyth.createPriceFeedUpdateData(
          tokenBID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataNative = await pyth.createPriceFeedUpdateData(
          nativeID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataPmx = await pyth.createPriceFeedUpdateData(
          PMXID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const pullOracleData = [[updateDataTokenA, updateDataTokenB, updateDataNative, updateDataPmx]];
        const pullOracleTypes = [UpdatePullOracle.Pyth];

        depositAmount = parseUnits("15", decimalsA);
        leverage = parseEther("2");
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenA.mint(trader.address, depositAmount);
        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
        const slPrice = 0;
        const tpPrice = 0;

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
            isProtocolFeeInPmx: false,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: pullOracleData,
            pullOracleTypes: pullOracleTypes,
          },
          { value: 4 },
        );

        const priceTokenA = await pyth.getPrice(tokenAID);
        const priceTokenB = await pyth.getPrice(tokenBID);
        const priceNative = await pyth.getPrice(nativeID);
        const pricePmx = await pyth.getPrice(PMXID);

        expect(priceTokenA.publishTime)
          .to.be.equal(priceTokenB.publishTime)
          .to.be.equal(priceNative.publishTime)
          .to.be.equal(pricePmx.publishTime)
          .to.be.equal(timeStamp);
        expect(priceTokenA.price)
          .to.be.equal(priceTokenB.price)
          .to.be.equal(priceNative.price)
          .to.be.equal(pricePmx.price)
          .to.be.equal(price);
      });

      it("Should update pyth oracle via openPositionByOrder function", async function () {
        const tokenAID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
        const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
        const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
        const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b4";
        const pyth = await getContract("MockPyth");

        await priceOracle.updatePythPairId(
          [testTokenA.address, testTokenB.address, await priceOracle.eth(), PMXToken.address],
          [tokenAID, tokenBID, nativeID, PMXID],
        );
        // price in 10**8
        const expo = -8;
        const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

        const timeStamp = (await provider.getBlock("latest")).timestamp;
        const updateDataTokenA = await pyth.createPriceFeedUpdateData(
          tokenAID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataTokenB = await pyth.createPriceFeedUpdateData(
          tokenBID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataNative = await pyth.createPriceFeedUpdateData(
          nativeID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataPmx = await pyth.createPriceFeedUpdateData(
          PMXID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        openPositionParams.pullOracleData = [[updateDataTokenA, updateDataTokenB, updateDataNative, updateDataPmx]];
        openPositionParams.pullOracleTypes = [UpdatePullOracle.Pyth];

        await limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams, { value: 4 });

        const priceTokenA = await pyth.getPrice(tokenAID);
        const priceTokenB = await pyth.getPrice(tokenBID);
        const priceNative = await pyth.getPrice(nativeID);
        const pricePmx = await pyth.getPrice(PMXID);

        expect(priceTokenA.publishTime)
          .to.be.equal(priceTokenB.publishTime)
          .to.be.equal(priceNative.publishTime)
          .to.be.equal(pricePmx.publishTime)
          .to.be.equal(timeStamp);
        expect(priceTokenA.price)
          .to.be.equal(priceTokenB.price)
          .to.be.equal(priceNative.price)
          .to.be.equal(pricePmx.price)
          .to.be.equal(price);
      });
      it("Should create position by order, increase traders count, add traderPositions and then deleted the order", async function () {
        const amount0Out = await getAmountsOut(dex, wadMul(depositAmount.toString(), leverage.toString()).toString(), [
          testTokenA.address,
          testTokenB.address,
        ]);
        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenB.address,
          amount0Out,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = amount0Out.sub(feeInPositionAsset);

        await limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams);
        const borrowIndex = await bucket.variableBorrowIndex();
        const borrowedAmount = wadMul(depositAmount.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position = await positionManager.getPosition(0);
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositAmount);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(positionAmountAfterFee);
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should open position by order and throw events 'OpenPosition' and 'PaidProtocolFee'", async function () {
        const positionId = 0;

        const amountAInWadDecimals = BigNumber.from(amountAIn).mul(multiplierA);
        const amountBOutWadDecimals = amountBOut.mul(multiplierB);

        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenB.address,
          amountBOut,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        let entryPrice = wadDiv(amountAInWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
        entryPrice = BigNumber.from(entryPrice).div(multiplierA);

        const txOpenPositionByOrder = await limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams);

        const position = await positionManager.getPosition(0);

        const expectedArguments = {
          positionId: positionId,
          trader: trader.address,
          openedBy: liquidator.address,
          position: position,
          entryPrice: entryPrice,
          leverage: leverage,
          closeConditions: [[TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice)]],
        };

        const expectedPaidProtocolFee = {
          positionId: positionId,
          trader: trader.address,
          positionAsset: testTokenB.address,
          feeRateType: FeeRateType.MarginLimitOrderExecuted,
          feeInPositionAsset: feeInPositionAsset,
          feeInPmx: 0,
        };

        eventValidation("OpenPosition", await txOpenPositionByOrder.wait(), expectedArguments, positionManager);
        eventValidation(
          "PaidProtocolFee",
          await txOpenPositionByOrder.wait(),
          expectedPaidProtocolFee,
          await getContractAt("PositionLibrary", positionManager.address),
        );
      });

      it("Should open position by order and throw event 'CloseLimitOrder'", async function () {
        const closeReasonFilledMargin = 0;
        const newPositionID = await positionManager.positionsId();
        const txCloseLimitOrder = await limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams);

        const expectedArguments = {
          orderId: orderId,
          trader: trader.address,
          closedBy: liquidator.address,
          reason: closeReasonFilledMargin,
          positionId: newPositionID,
          bucket: "bucket1",
          borrowedAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          leverage: leverage,
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
        };

        eventValidation("CloseLimitOrder", await txCloseLimitOrder.wait(), expectedArguments);
      });

      it("Should open position by order and receive fee to treasury", async function () {
        const amount0Out = await getAmountsOut(dex, wadMul(depositAmount.toString(), leverage.toString()).toString(), [
          testTokenA.address,
          testTokenB.address,
        ]);
        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenB.address,
          amount0Out,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        await expect(() => limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.changeTokenBalances(
          testTokenB,
          [Treasury],
          [feeInPositionAsset],
        );
      });
      it("Should open position by order with isProtocolFeeInPmx", async function () {
        await PMXToken.transfer(trader.address, parseEther("1"));
        await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));

        // isProtocolFeeInPmx false => true
        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: leverage,
          isProtocolFeeInPmx: true,
          nativeDepositOracleData: await getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const amount0Out = await getAmountsOut(dex, wadMul(depositAmount.toString(), leverage.toString()).toString(), [
          testTokenA.address,
          testTokenB.address,
        ]);
        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenB.address,
          amount0Out,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
        const feeInPositonAssetWithDiscount = wadMul(feeInPositionAsset.toString(), pmxDiscountMultiplier.toString()).toString();
        const feeAmountInPmx = await calculateFeeAmountInPmx(
          testTokenB.address,
          PMXToken.address,
          feeInPositonAssetWithDiscount,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        );

        const { availableBalance: availableBeforeTTA, lockedBalance: lockedBeforeTTA } = await traderBalanceVault.balances(
          trader.address,
          testTokenA.address,
        );
        await expect(() => limitOrderManager.connect(liquidator).openPositionByOrder(openPositionParams)).to.changeTokenBalances(
          PMXToken,
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInPmx).mul(NegativeOne).add(1), feeAmountInPmx.sub(1)],
        );

        const { availableBalance: availableAfterTTA, lockedBalance: lockedAfterTTA } = await traderBalanceVault.balances(
          trader.address,
          testTokenA.address,
        );
        expect(lockedBeforeTTA).to.equal(lockedBeforeAll.add(depositAmount));
        expect(lockedAfterTTA).to.equal(lockedBeforeAll);
        expect(availableBeforeTTA).to.equal(availableAfterTTA);
      });
      it("Should open position by order with isProtocolFeeInPmx when the pmx token has been changed", async function () {
        const newPMXToken = await getContract("PMXToken");
        await setupUsdOraclesForToken(newPMXToken, parseUnits("0.2", USD_DECIMALS));
        await newPMXToken.transfer(trader.address, parseEther("1"));
        await newPMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
        await traderBalanceVault.connect(trader).deposit(newPMXToken.address, parseEther("1"));

        // change the pmx token
        await PrimexDNS.connect(BigTimelockAdmin).setPMX(newPMXToken.address);

        // isProtocolFeeInPmx false => true
        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: leverage,
          isProtocolFeeInPmx: true,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const amount0Out = await getAmountsOut(dex, wadMul(depositAmount.toString(), leverage.toString()).toString(), [
          testTokenA.address,
          testTokenB.address,
        ]);
        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenB.address,
          amount0Out,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
        const feeInPositonAssetWithDiscount = wadMul(feeInPositionAsset.toString(), pmxDiscountMultiplier.toString()).toString();
        const feeAmountInPmx = await calculateFeeAmountInPmx(
          testTokenB.address,
          newPMXToken.address,
          feeInPositonAssetWithDiscount,
          getEncodedChainlinkRouteViaUsd(newPMXToken),
        );

        const { availableBalance: availableBeforeTTA, lockedBalance: lockedBeforeTTA } = await traderBalanceVault.balances(
          trader.address,
          testTokenA.address,
        );
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionParams,
          }),
        ).to.changeTokenBalances(
          newPMXToken,
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInPmx).mul(NegativeOne).sub(2), feeAmountInPmx.add(2)],
        );

        const { availableBalance: availableAfterTTA, lockedBalance: lockedAfterTTA } = await traderBalanceVault.balances(
          trader.address,
          testTokenA.address,
        );
        expect(lockedBeforeTTA).to.equal(lockedBeforeAll.add(depositAmount));
        expect(lockedAfterTTA).to.equal(lockedBeforeAll);
        expect(availableBeforeTTA).to.equal(availableAfterTTA);
      });
    });

    describe("updateOrder", function () {
      let primexPricingLibraryMock,
        limitPrice,
        leverage,
        leverageDecimals,
        depositAmountX,
        stopLossPrice,
        takeProfitPrice,
        liquidationPrice,
        orderId;
      before(async function () {
        const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
          libraries: {
            PrimexPricingLibrary: primexPricingLibrary.address,
          },
        });
        primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
        await primexPricingLibraryMock.deployed();

        depositAmountX = parseUnits("15", decimalsX);
        leverageDecimals = 18;
        leverage = parseUnits("2", leverageDecimals);
        const amountAIn = wadMul(depositAmount.toString(), leverage.toString()).toString();

        const amountBOut = await getAmountsOut(dex, amountAIn, [testTokenA.address, testTokenB.address]);
        const amountAInWadDecimals = BigNumber.from(amountAIn).mul(multiplierA).toString();
        const amountBOutInWadDecimals = amountBOut.mul(multiplierB).toString();
        const price = BigNumber.from(wadDiv(amountAInWadDecimals, amountBOutInWadDecimals.toString()).toString());
        limitPrice = price.div(multiplierA);
        liquidationPrice = await primexPricingLibraryMock.callStatic.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          limitPrice,
          leverage,
        );

        const difference = limitPrice.sub(liquidationPrice).div(2);
        stopLossPrice = limitPrice.sub(difference).mul(multiplierA);
        takeProfitPrice = limitPrice.add(difference).mul(multiplierA);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        orderId = await limitOrderManager.ordersId();
      });

      it("Should revert updateOrder when the msg.sender is on the blacklist", async function () {
        await whiteBlackList.addAddressToBlacklist(mockContract.address);
        await expect(
          limitOrderManager.connect(mockContract).updateOrder({
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: leverage,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
      });

      it("Should revert updateOrder when the bucket is not active", async function () {
        await PrimexDNS.deprecateBucket("bucket1");
        await expect(
          limitOrderManager.connect(trader).updateOrder({
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: leverage,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_NOT_ACTIVE");
      });

      it("Should revert when caller is not trader", async function () {
        await expect(
          limitOrderManager.connect(lender).updateOrder({
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: leverage,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_TRADER");
      });

      it("Should revert when leverage < 1", async function () {
        await expect(
          limitOrderManager.connect(trader).updateOrder({
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: BigNumber.from(WAD.toString()).sub(1),
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_MUST_BE_MORE_THAN_1");
      });

      it("Should revert when leverage > maxLeverage", async function () {
        const feeRate = parseEther("0.003");
        const maxLeverage = await bucket["maxAssetLeverage(address,uint256)"](testTokenB.address, feeRate);
        await expect(
          limitOrderManager.connect(trader).updateOrder({
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: maxLeverage.add(1),
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_EXCEEDS_MAX_LEVERAGE");
      });

      it("Should revert when convert margin order to spot order", async function () {
        const spotLeverage = parseUnits("1", leverageDecimals);

        await expect(
          limitOrderManager.connect(trader).updateOrder({
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: spotLeverage,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_MUST_BE_MORE_THAN_1");
      });

      it("Should revert when convert spot order to margin order", async function () {
        const depositAmountB = parseUnits("15", decimalsB);
        const limitPriceInB = limitPrice.mul(multiplierA).div(multiplierB);
        const liquidationPriceInB = liquidationPrice.mul(multiplierA).div(multiplierB);

        const difference = limitPriceInB.sub(liquidationPriceInB).div(2);
        const stopLossPriceB = limitPriceInB.sub(difference).mul(multiplierB);
        const takeProfitPriceB = limitPriceInB.add(difference).mul(multiplierB);
        await testTokenB.connect(trader).mint(trader.address, depositAmountB);
        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB);

        const deadline = new Date().getTime() + 600;
        const spotLeverage = parseUnits("1", leverageDecimals);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenA.address,
          deadline: deadline,
          takeDepositFromWallet: true,
          leverage: spotLeverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPriceInB))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPriceB, stopLossPriceB))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderId = await limitOrderManager.ordersId();
        const newLeverage = parseUnits("2", leverageDecimals);

        await expect(
          limitOrderManager.connect(trader).updateOrder({
            orderId: orderId,
            depositAmount: depositAmountB,
            leverage: newLeverage,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "CANNOT_CHANGE_SPOT_ORDER_TO_MARGIN");
      });

      it("Should revert when depositAmount * leverage < minPositionSize", async function () {
        const gasPrice = parseUnits("1000", "gwei");
        const newDepositAmount = parseUnits("0.01", decimalsA);
        await expect(
          limitOrderManager.connect(trader).updateOrder(
            {
              orderId: orderId,
              depositAmount: newDepositAmount,
              takeDepositFromWallet: false,
              leverage: leverage,
              nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
              pullOracleData: [],
              pullOracleTypes: [],
            },
            { gasPrice },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });

      it("Should increase leverage from wallet", async function () {
        const newLeverage = leverage.add(parseEther("0.5"));

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: newLeverage,
          takeDepositFromWallet: true,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(depositAmount);
      });

      it("Should update pyth oracle via openPositionByOrder function", async function () {
        const tokenAID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
        const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
        const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
        const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b4";
        const pyth = await getContract("MockPyth");

        await priceOracle.updatePythPairId(
          [testTokenA.address, testTokenB.address, await priceOracle.eth(), PMXToken.address],
          [tokenAID, tokenBID, nativeID, PMXID],
        );
        // price in 10**8
        const expo = -8;
        const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

        const timeStamp = (await provider.getBlock("latest")).timestamp;
        const updateDataTokenA = await pyth.createPriceFeedUpdateData(
          tokenAID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataTokenB = await pyth.createPriceFeedUpdateData(
          tokenBID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataNative = await pyth.createPriceFeedUpdateData(
          nativeID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const updateDataPmx = await pyth.createPriceFeedUpdateData(
          PMXID,
          price,
          0,
          expo, // expo
          0,
          0,
          timeStamp,
          0,
        );
        const newLeverage = leverage.add(parseEther("0.5"));
        await limitOrderManager.connect(trader).updateOrder(
          {
            orderId: orderId,
            depositAmount: depositAmount,
            leverage: newLeverage,
            takeDepositFromWallet: true,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [[updateDataTokenA, updateDataTokenB, updateDataNative, updateDataPmx]],
            pullOracleTypes: [UpdatePullOracle.Pyth],
          },
          { value: 4 },
        );

        const priceTokenA = await pyth.getPrice(tokenAID);
        const priceTokenB = await pyth.getPrice(tokenBID);
        const priceNative = await pyth.getPrice(nativeID);
        const pricePmx = await pyth.getPrice(PMXID);

        expect(priceTokenA.publishTime)
          .to.be.equal(priceTokenB.publishTime)
          .to.be.equal(priceNative.publishTime)
          .to.be.equal(pricePmx.publishTime)
          .to.be.equal(timeStamp);
        expect(priceTokenA.price)
          .to.be.equal(priceTokenB.price)
          .to.be.equal(priceNative.price)
          .to.be.equal(pricePmx.price)
          .to.be.equal(price);
      });

      it("Should increase leverage from wallet  when source of deposit is different from fee source", async function () {
        const newLeverage = leverage.add(parseEther("0.5"));
        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: newLeverage,
          takeDepositFromWallet: true,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(depositAmount);
      });

      it("Should increase leverage from traderBalanceVault", async function () {
        const newLeverage = leverage.add(parseEther("0.5"));

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: newLeverage,
          takeDepositFromWallet: false,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(depositAmount);
      });

      it("Should decrease leverage", async function () {
        const newLeverage = leverage.sub(parseEther("0.5"));

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: newLeverage,
          takeDepositFromWallet: true,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(depositAmount);
      });

      it("Should decrease depositAmount", async function () {
        const newDepositAmount = depositAmount.sub(parseUnits("1", decimalsA));

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: newDepositAmount,
          leverage: leverage,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const order = await limitOrderManager.getOrder(1);
        expect(order.depositAmount).to.be.equal(newDepositAmount);
        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(newDepositAmount);
      });

      it("Should increase depositAmount from wallet", async function () {
        const increaseAmount = parseUnits("1", decimalsA);
        const newDepositAmount = depositAmount.add(increaseAmount);
        await testTokenA.connect(trader).approve(limitOrderManager.address, increaseAmount);

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: newDepositAmount,
          takeDepositFromWallet: true,
          leverage: leverage,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const order = await limitOrderManager.getOrder(1);
        expect(order.depositAmount).to.be.equal(newDepositAmount);
        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(newDepositAmount);
      });

      it("Should increase depositAmount from trader balance vault", async function () {
        const increaseAmount = parseUnits("1", decimalsA);
        const newDepositAmount = depositAmount.add(increaseAmount);
        await testTokenA.connect(trader).approve(traderBalanceVault.address, newDepositAmount);
        await traderBalanceVault.connect(trader).deposit(testTokenA.address, newDepositAmount);

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: newDepositAmount,
          takeDepositFromWallet: false,
          leverage: leverage,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const order = await limitOrderManager.getOrder(1);
        expect(order.depositAmount).to.be.equal(newDepositAmount);

        const { lockedBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(balanceAfter).to.equal(newDepositAmount);
      });

      it("Should change the protocolFeeAsset", async function () {
        const isProtocolFeeInPmx = true;

        await limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          takeDepositFromWallet: true,
          leverage: leverage,
          isProtocolFeeInPmx: isProtocolFeeInPmx,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const order = await limitOrderManager.getOrder(1);
        expect(order.feeToken).to.be.equal(PMXToken.address);
      });

      it("Should emit event after order update", async function () {
        await testTokenX.connect(trader).approve(limitOrderManager.address, depositAmountX);
        const newLeverage = parseUnits("2", leverageDecimals);
        const isProtocolFeeInPmx = true;

        await expect(
          limitOrderManager.connect(trader).updateOrder({
            orderId: orderId,
            depositAmount: depositAmountX,
            takeDepositFromWallet: true,
            leverage: newLeverage,
            isProtocolFeeInPmx: isProtocolFeeInPmx,
            nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        )
          .to.emit(limitOrderManager, "UpdateOrder")
          .withArgs(orderId, trader.address, depositAmountX, newLeverage, PMXToken.address);
      });
    });
  });

  describe("updateOrderConditions", function () {
    let primexPricingLibraryMock,
      limitPrice,
      leverage,
      leverageDecimals,
      depositAmount,
      stopLossPrice,
      takeProfitPrice,
      liquidationPrice,
      orderId;
    before(async function () {
      const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
      await primexPricingLibraryMock.deployed();

      depositAmount = parseUnits("15", decimalsA);
      leverageDecimals = 18;
      leverage = parseUnits("2", leverageDecimals);
      const amountAIn = wadMul(depositAmount.toString(), leverage.toString()).toString();

      const amountBOut = await getAmountsOut(dex, amountAIn, [testTokenA.address, testTokenB.address]);
      const amountAInWadDecimals = BigNumber.from(amountAIn).mul(multiplierA);
      const amountBOutInWadDecimals = amountBOut.mul(multiplierB);
      limitPrice = BigNumber.from(wadDiv(amountAInWadDecimals.toString(), amountBOutInWadDecimals.toString()).toString());
      limitPrice = limitPrice.div(multiplierA);
      liquidationPrice = await primexPricingLibraryMock.callStatic.getLiquidationPriceByOrder(
        bucketAddress,
        testTokenB.address,
        limitPrice,
        leverage,
      );
      stopLossPrice = liquidationPrice.add(parseUnits("1", decimalsA)).mul(multiplierA);
      takeProfitPrice = limitPrice.add(parseUnits("1", decimalsA)).mul(multiplierA);
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAmount: depositAmount,
        depositAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      orderId = await limitOrderManager.ordersId();
    });
    it("Should revert when caller is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        limitOrderManager.connect(mockContract).updateOrderConditions({
          orderId: orderId,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert when caller is not trader", async function () {
      await expect(
        limitOrderManager.connect(liquidator).updateOrderConditions({
          orderId: orderId,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_TRADER");
    });
    it("Should revert updateOrderConditions when the bucket is not active", async function () {
      await PrimexDNS.freezeBucket("bucket1");
      await expect(
        limitOrderManager.connect(trader).updateOrderConditions({
          orderId: orderId,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_NOT_ACTIVE");
      await PrimexDNS.activateBucket("bucket1");
    });
    it("Should revert when updated with no open conditions", async function () {
      await expect(
        limitOrderManager.connect(trader).updateOrderConditions({
          orderId: orderId,
          openConditions: [],
          closeConditions: [],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_HAVE_OPEN_CONDITIONS");
    });

    it("Should change open conditions and update updatedConditionsAt", async function () {
      const newLimitPrice = limitPrice.add(1);

      const { updatedConditionsAt: updatedConditionsAtBefore } = await limitOrderManager.getOrder(orderId);
      await limitOrderManager.connect(trader).updateOrderConditions({
        orderId: orderId,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(newLimitPrice))],
        closeConditions: [],
      });
      const latestTimeStamp = (await provider.getBlock("latest")).timestamp;
      const { updatedConditionsAt: updatedConditionsAtAfter } = await limitOrderManager.getOrder(orderId);
      expect(updatedConditionsAtBefore).to.not.equal(updatedConditionsAtAfter);
      expect(updatedConditionsAtAfter).to.be.equal(latestTimeStamp);
    });

    it("Should change prices", async function () {
      const newLimitPrice = limitPrice.add(1);
      const newStopLossPrice = stopLossPrice.add(1);
      const newTakeProfitPrice = takeProfitPrice.sub(1);

      await limitOrderManager.connect(trader).updateOrderConditions({
        orderId: orderId,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(newLimitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(newTakeProfitPrice, newStopLossPrice))],
      });

      const closeCondition = (await limitOrderManager.getCloseConditions(orderId))[0];
      const canBeClosedParams = await takeProfitStopLossCCM.getTakeProfitStopLossPrices(arrayify(closeCondition.params));
      const openCondition = (await limitOrderManager.getOpenConditions(orderId))[0];
      const comLimitPrice = await limitPriceCOM.getLimitPrice(arrayify(openCondition.params));

      expect(comLimitPrice).to.be.equal(newLimitPrice);
      expect(canBeClosedParams[0]).to.be.equal(newTakeProfitPrice);
      expect(canBeClosedParams[1]).to.be.equal(newStopLossPrice);
    });

    it("Should be able to set TP/SL prices to 0", async function () {
      await limitOrderManager.connect(trader).updateOrderConditions({
        orderId: orderId,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
        closeConditions: [],
      });

      const closeCondition = await limitOrderManager.getCloseConditions(orderId);

      expect(closeCondition.length).to.be.equal(0);
    });

    it("Should emit event after updateOrderConditions", async function () {
      const newLimitPrice = limitPrice.add(1);
      const newStopLossPrice = stopLossPrice.add(1);
      const newTakeProfitPrice = takeProfitPrice.sub(1);

      const tx = await limitOrderManager.connect(trader).updateOrderConditions({
        orderId: orderId,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(newLimitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(newTakeProfitPrice, newStopLossPrice))],
      });

      const expectedUpdateOrderConditions = {
        orderId: orderId,
        trader: trader.address,
        openConditions: [[LIMIT_PRICE_CM_TYPE, getLimitPriceParams(newLimitPrice)]],
        closeConditions: [[TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(newTakeProfitPrice, newStopLossPrice)]],
      };

      eventValidation("UpdateOrderConditions", await tx.wait(), expectedUpdateOrderConditions);
    });
  });

  describe("getBestDexByOrder for limit orders", function () {
    let snapshotId;
    let dexesWithAncillaryData, estimateGasAmountDex, estimateGasAmountDex2;
    before(async function () {
      dexesWithAncillaryData = [
        {
          dex: dex,
          ancillaryData: ancillaryDexData,
        },
        {
          dex: dex2,
          ancillaryData: ancillaryDexData2,
        },
      ];

      estimateGasAmountDex = await getGas(dex);
      estimateGasAmountDex2 = await getGas(dex2);
      const leverage = parseEther("2");
      const lenderAmount = parseUnits("50", decimalsA);
      const depositAmount = parseUnits("15", decimalsA);

      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = false;

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
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
    it("When first dex is best to swap borrowedAmount return correct dexes name", async function () {
      const { depositAmount, leverage } = await limitOrderManager.getOrder(1);

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("1", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const depositInBorrowed = wadMul(depositAmount.toString(), leverage.toString()).toString();
      const amount0Out1 = await getAmountsOut(dex, depositInBorrowed, [testTokenA.address, testTokenB.address]);
      const amount0Out2 = await getAmountsOut(dex2, depositInBorrowed, [testTokenA.address, testTokenB.address]);

      expect(amount0Out1).to.be.gt(amount0Out2);
      const bestShares = await bestDexLens.callStatic[
        "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[],bytes,bytes[][],uint256[]))"
      ]([
        positionManager.address,
        limitOrderManager.address,
        1,
        { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
        dexesWithAncillaryData,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      ]);

      parseArguments(bestShares.firstAssetReturnParams, {
        returnAmount: amount0Out1,
        estimateGasAmount: estimateGasAmountDex,
        megaRoutes: firstAssetMegaRoutes,
      });
      parseArguments(bestShares.depositInThirdAssetReturnParams, {
        returnAmount: 0,
        estimateGasAmount: 0,
        megaRoutes: [],
      });
      parseArguments(bestShares.depositToBorrowedReturnParams, {
        returnAmount: 0,
        estimateGasAmount: 0,
        megaRoutes: [],
      });
    });

    it("When second dex is best to swap borrowedAmount return correct dexes name", async function () {
      const { depositAmount, leverage } = await limitOrderManager.getOrder(1);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const depositInBorrowed = wadMul(depositAmount.toString(), leverage.toString()).toString();
      const amount0Out1 = await getAmountsOut(dex, depositInBorrowed, [testTokenA.address, testTokenB.address]);
      const amount0Out2 = await getAmountsOut(dex2, depositInBorrowed, [testTokenA.address, testTokenB.address]);
      expect(amount0Out2).to.be.gt(amount0Out1);

      const bestShares = await bestDexLens.callStatic[
        "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[],bytes,bytes[][],uint256[]))"
      ]([
        positionManager.address,
        limitOrderManager.address,
        1,
        { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
        dexesWithAncillaryData,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      ]);

      parseArguments(bestShares.firstAssetReturnParams, {
        returnAmount: amount0Out2,
        estimateGasAmount: estimateGasAmountDex2,
        megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex2),
      });
      parseArguments(bestShares.depositInThirdAssetReturnParams, {
        returnAmount: 0,
        estimateGasAmount: 0,
        megaRoutes: [],
      });
      parseArguments(bestShares.depositToBorrowedReturnParams, {
        returnAmount: 0,
        estimateGasAmount: 0,
        megaRoutes: [],
      });
    });

    it("When multiple shares return correct dexes", async function () {
      const { depositAmount, leverage } = await limitOrderManager.getOrder(1);

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("1", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const halfDepositInBorrowed = BigNumber.from(wadMul(depositAmount.toString(), leverage.toString()).toString()).div(2);
      const amount0Out1 = await getAmountsOut(dex, halfDepositInBorrowed, [testTokenA.address, testTokenB.address]);
      const amount0Out2 = await getAmountsOut(dex2, halfDepositInBorrowed, [testTokenA.address, testTokenB.address]);

      const bestShares = await bestDexLens.callStatic[
        "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[],bytes,bytes[][],uint256[]))"
      ]([
        positionManager.address,
        limitOrderManager.address,
        1,
        { firstAssetShares: 2, depositInThirdAssetShares: 2, depositToBorrowedShares: 2 },
        dexesWithAncillaryData,
        await getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      ]);

      const expectedRoutes = await getMegaRoutes([
        {
          shares: 1,
          routesData: [
            {
              to: testTokenB.address,
              pathData: [
                {
                  dex: dex,
                  path: [testTokenA.address, testTokenB.address],
                  shares: 1,
                },
                {
                  dex: dex2,
                  path: [testTokenA.address, testTokenB.address],
                  shares: 1,
                },
              ],
            },
          ],
        },
      ]);

      parseArguments(bestShares.firstAssetReturnParams, {
        returnAmount: amount0Out1.add(amount0Out2),
        estimateGasAmount: estimateGasAmountDex.add(estimateGasAmountDex2),
        megaRoutes: expectedRoutes,
      });
      parseArguments(bestShares.depositInThirdAssetReturnParams, {
        returnAmount: 0,
        estimateGasAmount: 0,
        megaRoutes: [],
      });
      parseArguments(bestShares.depositToBorrowedReturnParams, {
        returnAmount: 0,
        estimateGasAmount: 0,
        megaRoutes: [],
      });
    });
  });

  describe("Order mappings", function () {
    let snapshotId;

    before(async function () {
      const lenderAmount = parseUnits("50", decimalsA);
      const traderAmount = parseUnits("15", decimalsA);
      const leverage = parseEther("2");

      await testTokenA.connect(trader).approve(traderBalanceVault.address, traderAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, traderAmount);
      await testTokenA.connect(lender).approve(traderBalanceVault.address, traderAmount);
      await traderBalanceVault.connect(lender).deposit(testTokenA.address, traderAmount);

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      const bucketName2 = "bucket2";
      const assets = [testTokenB.address];
      const underlyingAsset = testTokenA.address;
      const feeBuffer = "1000200000000000000"; // 1.0002
      const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
      const reserveRate = "100000000000000000"; // 0.1 - 10%
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
      const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

      const txCreateBucket = await BucketsFactory.createBucket({
        nameBucket: bucketName2,
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        dns: PrimexDNS.address,
        reserve: mockReserve.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: assets,
        underlyingAsset: underlyingAsset,
        feeBuffer: feeBuffer,
        whiteBlackList: whiteBlackList.address,
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
          newBucketAddress = getAddress("0x" + txCreateBucketReceipt.events[i].data.slice(26));
        }
      }
      await PrimexDNS.addBucket(newBucketAddress, 0);
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: parseEther("1") });
      await traderBalanceVault.connect(lender).deposit(NATIVE_CURRENCY, 0, { value: parseEther("1") });

      const newBucket = await getContractAt("Bucket", newBucketAddress);
      await testTokenA.connect(lender).approve(newBucketAddress, MaxUint256);
      await newBucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("50", decimalsA), true);

      await setOraclePrice(testTokenA, testTokenB, parseUnits("1", USD_DECIMALS));
      const depositAmount = parseUnits("1", decimalsA);
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = false;

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await limitOrderManager.connect(lender).createLimitOrder({
        bucket: "bucket2",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await limitOrderManager.connect(lender).createLimitOrder({
        bucket: "bucket2",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await limitOrderManager.connect(lender).createLimitOrder({
        bucket: "bucket2",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket2",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseUnits("1", decimalsA)))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
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

    it("Should revert if order does not exist", async function () {
      const orderId = 10;
      await expect(limitOrderManager.getOrder(orderId)).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_DOES_NOT_EXIST");
    });

    it("Should have correct order count for different traders", async function () {
      let firstTraderOrders = await limitOrderManager.getTraderOrders(trader.address);
      expect(firstTraderOrders.length).to.equal(3);
      let secondTraderOrders = await limitOrderManager.getTraderOrders(lender.address);
      expect(secondTraderOrders.length).to.equal(3);

      await limitOrderManager.connect(lender).cancelLimitOrder(3);

      firstTraderOrders = await limitOrderManager.getTraderOrders(trader.address);
      expect(firstTraderOrders.length).to.equal(3);
      secondTraderOrders = await limitOrderManager.getTraderOrders(lender.address);
      expect(secondTraderOrders.length).to.equal(2);
    });

    it("Should have correct order count for different buckets", async function () {
      const firstBucketOrders = await limitOrderManager.getBucketOrders(bucketAddress);
      expect(firstBucketOrders.length).to.equal(2);
      const secondBucketOrders = await limitOrderManager.getBucketOrders(newBucketAddress);
      expect(secondBucketOrders.length).to.equal(4);

      await limitOrderManager.connect(lender).cancelLimitOrder(4);
      await limitOrderManager.connect(trader).cancelLimitOrder(1);

      expect(await limitOrderManager.getBucketOrdersLength(bucketAddress)).to.equal(1);
      expect(await limitOrderManager.getBucketOrdersLength(newBucketAddress)).to.equal(3);
    });

    it("Should have correct order indexes", async function () {
      expect(await limitOrderManager.orderIndexes(5)).to.equal(4);

      await limitOrderManager.connect(trader).cancelLimitOrder(2);

      expect(await limitOrderManager.getOrdersLength()).to.equal(5);
      expect(await limitOrderManager.orderIndexes(6)).to.equal(1);
    });

    it("Should have correct order indexes for trader", async function () {
      expect(await limitOrderManager.traderOrderIds(trader.address, 2)).to.equal(6);
      expect(await limitOrderManager.traderOrderIds(trader.address, 1)).to.equal(2);
      expect(await limitOrderManager.traderOrderIds(trader.address, 0)).to.equal(1);
      expect(await limitOrderManager.traderOrderIndexes(6)).to.equal(2);
      expect(await limitOrderManager.traderOrderIndexes(2)).to.equal(1);
      expect(await limitOrderManager.traderOrderIndexes(1)).to.equal(0);

      await limitOrderManager.connect(trader).cancelLimitOrder(1);

      expect(await limitOrderManager.getTraderOrdersLength(trader.address)).to.equal(2);
      expect(await limitOrderManager.traderOrderIds(trader.address, 1)).to.equal(2);
      expect(await limitOrderManager.traderOrderIds(trader.address, 0)).to.equal(6);
      expect(await limitOrderManager.traderOrderIndexes(6)).to.equal(0);
      expect(await limitOrderManager.traderOrderIndexes(2)).to.equal(1);
    });

    it("Should have correct order indexes for buckets", async function () {
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 3)).to.equal(6);
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 2)).to.equal(5);
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 1)).to.equal(4);
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 0)).to.equal(3);
      expect(await limitOrderManager.bucketOrderIndexes(6)).to.equal(3);
      expect(await limitOrderManager.bucketOrderIndexes(5)).to.equal(2);
      expect(await limitOrderManager.bucketOrderIndexes(4)).to.equal(1);
      expect(await limitOrderManager.bucketOrderIndexes(3)).to.equal(0);

      await limitOrderManager.connect(lender).cancelLimitOrder(4);

      expect(await limitOrderManager.getBucketOrdersLength(newBucketAddress)).to.equal(3);
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 2)).to.equal(5);
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 1)).to.equal(6);
      expect(await limitOrderManager.bucketOrderIds(newBucketAddress, 0)).to.equal(3);
      expect(await limitOrderManager.bucketOrderIndexes(6)).to.equal(1);
      expect(await limitOrderManager.bucketOrderIndexes(5)).to.equal(2);
      expect(await limitOrderManager.bucketOrderIndexes(3)).to.equal(0);
    });
  });

  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(limitOrderManager.connect(trader).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(limitOrderManager.connect(trader).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });

  describe("setSwapManager", function () {
    it("Should revert if not BigTimelockAdmin call ", async function () {
      const mockSwapManager = await deployMockSwapManager(deployer);
      await expect(limitOrderManager.connect(trader).setSwapManager(mockSwapManager.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if the new swap manager is not supported", async function () {
      const mockSwapManager = await deployMockSwapManager(deployer);
      await mockSwapManager.mock.supportsInterface.returns(false);
      await expect(limitOrderManager.connect(BigTimelockAdmin).setSwapManager(mockSwapManager.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should successfully set net swap manager", async function () {
      const mockSwapManager = await deployMockSwapManager(deployer);
      await limitOrderManager.connect(BigTimelockAdmin).setSwapManager(mockSwapManager.address);
      expect(await limitOrderManager.swapManager()).to.be.equal(mockSwapManager.address);
    });
  });
});
