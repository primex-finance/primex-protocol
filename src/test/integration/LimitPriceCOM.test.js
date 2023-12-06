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
    constants: { MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getTakeProfitStopLossParams,
  getCondition,
} = require("../utils/conditionParams");

const { getAmountsOut, addLiquidity, getSingleRoute } = require("../utils/dexOperations");

const { LIMIT_PRICE_CM_TYPE, TAKE_PROFIT_STOP_LOSS_CM_TYPE, MAX_TOKEN_DECIMALITY, NATIVE_CURRENCY } = require("../utils/constants");

const { wadDiv, wadMul } = require("../utils/math");

process.env.TEST = true;

describe("LimitPriceCOM_integration", function () {
  let snapshotId;
  let trader, lender, deployer;
  let primexDNS,
    priceOracle,
    positionManager,
    limitOrderManager,
    limitPriceCOM,
    limitOrderLibrary,
    primexPricingLibrary,
    primexPricingLibraryMock,
    traderBalanceVault,
    registry,
    testTokenA,
    testTokenB,
    testTokenX,
    priceFeedTTATTX,
    ttaPriceInNative,
    bucket,
    priceFeed,
    ErrorsLibrary,
    decimalsA,
    decimalsB,
    decimalsX,
    multiplierA,
    multiplierB;
  let firstAssetRoutes, dex, bucketAddress;

  before(async function () {
    await fixture(["Test"]);
    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }

    ({ trader, lender, deployer } = await getNamedSigners());
    limitPriceCOM = await getContract("LimitPriceCOM");
    primexDNS = await getContract("PrimexDNS");
    priceOracle = await getContract("PriceOracle");
    positionManager = await getContract("PositionManager");
    limitOrderManager = await getContract("LimitOrderManager");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();
    limitOrderLibrary = await getContract("LimitOrderLibrary");
    registry = await getContract("Registry");
    traderBalanceVault = await getContract("TraderBalanceVault");
    ErrorsLibrary = await getContract("Errors");

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    priceOracle = await getContract("PriceOracle");
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTANATIVE = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_NATIVE", deployer.address);
    ttaPriceInNative = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTANATIVE.setDecimals("18");
    await priceFeedTTANATIVE.setAnswer(ttaPriceInNative);

    await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: parseEther("1") });

    await priceOracle.updatePriceFeed(testTokenA.address, NATIVE_CURRENCY, priceFeedTTANATIVE.address);
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);

    await addLiquidity({
      dex: dex,
      from: "lender",
      tokenA: testTokenA,
      tokenB: testTokenB,
      amountADesired: "10000",
      amountBDesired: "10000",
    });

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    decimalsX = await testTokenX.decimals();
    await priceOracle.updatePriceFeed(testTokenX.address, NATIVE_CURRENCY, priceFeedTTANATIVE.address);

    await addLiquidity({ dex: dex, from: "trader", tokenA: testTokenX, tokenB: testTokenB });

    priceFeedTTATTX = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTA_TTX", deployer.address);
    await priceOracle.updatePriceFeed(testTokenX.address, testTokenA.address, priceFeedTTATTX.address);
    await priceFeedTTATTX.setAnswer(parseEther("1"));
    await priceFeedTTATTX.setDecimals("18");

    const priceFeedTTXTTB = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTB", deployer.address);
    await priceOracle.updatePriceFeed(testTokenX.address, testTokenB.address, priceFeedTTXTTB.address);
    await priceFeedTTXTTB.setAnswer(parseEther("1"));
    await priceFeedTTXTTB.setDecimals("18");
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
    it("Should initialize with correct values", async function () {
      expect(await limitPriceCOM.primexDNS()).to.equal(primexDNS.address);
      expect(await limitPriceCOM.priceOracle()).to.equal(priceOracle.address);
      expect(await limitPriceCOM.pm()).to.equal(positionManager.address);
    });

    it("Should revert when initialized with wrong primexDNS address", async function () {
      const wrongAddress = registry.address;
      await expect(
        run("deploy:LimitPriceCOM", {
          registry: registry.address,
          primexDNS: wrongAddress,
          priceOracle: priceOracle.address,
          positionManager: positionManager.address,
          primexPricingLibrary: primexPricingLibrary.address,
          limitOrderLibrary: limitOrderLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong priceOracle address", async function () {
      const wrongAddress = registry.address;
      await expect(
        run("deploy:LimitPriceCOM", {
          registry: registry.address,
          primexDNS: primexDNS.address,
          priceOracle: wrongAddress,
          positionManager: positionManager.address,
          primexPricingLibrary: primexPricingLibrary.address,
          limitOrderLibrary: limitOrderLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong positionManager address", async function () {
      const wrongAddress = registry.address;
      await expect(
        run("deploy:LimitPriceCOM", {
          registry: registry.address,
          primexDNS: primexDNS.address,
          priceOracle: priceOracle.address,
          positionManager: wrongAddress,
          primexPricingLibrary: primexPricingLibrary.address,
          limitOrderLibrary: limitOrderLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("canBeFilled", function () {
    let orderId1, orderId2, orderId3, orderId4, defaultAdditionalParams, conditionIndex;
    before(async function () {
      conditionIndex = 0;
      const depositAmount = parseUnits("15", decimalsA);
      const deadline = new Date().getTime() + 600;
      const leverage = parseEther("2.5");
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;

      const lenderAmount = parseUnits("50", decimalsA);
      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      const amountAIn = wadMul(depositAmount.toString(), leverage.toString()).toString();
      const amountAInWadDecimals = BigNumber.from(amountAIn).mul(multiplierA);
      const amountBOut = await getAmountsOut(dex, amountAIn, [testTokenA.address, testTokenB.address]);
      const amountBInWadDecimals = amountBOut.mul(multiplierB);

      const limitPriceInWad = BigNumber.from(wadDiv(amountAInWadDecimals.toString(), amountBInWadDecimals.toString()).toString());
      const limitPrice = limitPriceInWad.div(multiplierA);
      await priceFeed.setAnswer(limitPrice);
      await priceFeed.setDecimals(decimalsA);

      await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

      const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
        bucketAddress,
        testTokenB.address,
        limitPrice,
        leverage,
      );

      const difference = limitPrice.sub(liquidationPrice).div(2);
      const stopLossPrice = limitPrice.sub(difference).mul(multiplierA);

      await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256);
      await limitOrderManager.connect(trader).createLimitOrder(
        {
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        },
        { value: parseEther("2") },
      );

      orderId1 = await limitOrderManager.ordersId();
      await limitOrderManager.connect(trader).createLimitOrder(
        {
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.add(1)))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        },
        { value: parseEther("1") },
      );

      orderId2 = await limitOrderManager.ordersId();
      await limitOrderManager.connect(trader).createLimitOrder(
        {
          bucket: "bucket1",
          depositAsset: testTokenA.address,
          depositAmount: depositAmount,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.sub(1)))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        },
        { value: parseEther("1") },
      );
      orderId3 = await limitOrderManager.ordersId();

      await testTokenX.connect(trader).approve(limitOrderManager.address, MaxUint256);
      const depositAmountX = parseUnits("15", decimalsX);
      await limitOrderManager.connect(trader).createLimitOrder(
        {
          bucket: "bucket1",
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(MaxUint256.div(2)))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        },
        { value: parseEther("1") },
      );
      orderId4 = await limitOrderManager.ordersId();

      defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, []);
    });

    it("Should revert when depositInThirdAssetRoutes length isn't 0", async function () {
      const additionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, firstAssetRoutes, []);
      await expect(limitOrderManager.callStatic.canBeFilled(orderId2, conditionIndex, additionalParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0",
      );
    });

    it("Should return true when limitPrice is less than current price on dex", async function () {
      expect(await limitOrderManager.callStatic.canBeFilled(orderId2, conditionIndex, defaultAdditionalParams)).to.be.equal(true);
    });

    it("Should return true when limitPrice is current price on dex ", async function () {
      expect(await limitOrderManager.callStatic.canBeFilled(orderId1, conditionIndex, defaultAdditionalParams)).to.be.equal(true);
    });

    it("Should return false when limitPrice is more than current price on dex ", async function () {
      expect(await limitOrderManager.callStatic.canBeFilled(orderId3, conditionIndex, defaultAdditionalParams)).to.be.equal(false);
    });

    it("Should return false when limitPrice > current price(10) but deadline < block.timestamp", async function () {
      await network.provider.send("evm_setNextBlockTimestamp", [new Date().getTime() + 800]);
      await network.provider.send("evm_mine");
      expect(await limitOrderManager.callStatic.canBeFilled(orderId2, conditionIndex, defaultAdditionalParams)).to.be.equal(false);
    });

    it("Should return false when calculated leverage is more then maxAssetLeverage", async function () {
      await priceFeedTTATTX.setAnswer(parseEther("10000"));
      const thirdAssetRoutes = await getSingleRoute([testTokenX.address, testTokenB.address], dex);
      const params = getLimitPriceAdditionalParams(firstAssetRoutes, thirdAssetRoutes);
      expect(await limitOrderManager.callStatic.canBeFilled(orderId4, conditionIndex, params)).to.be.equal(false);
    });

    it("Should return false when size of opened position by this order will be more than maximum position size by pair", async function () {
      await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, 0);
      expect(await limitOrderManager.callStatic.canBeFilled(orderId1, conditionIndex, defaultAdditionalParams)).to.be.equal(false);
    });
  });
});
