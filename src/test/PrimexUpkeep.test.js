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
const { addLiquidity, checkIsDexSupported, getAncillaryDexData, getAmountsOut, getSingleMegaRoute } = require("./utils/dexOperations");
const { wadDiv } = require("./utils/math");
const {
  deployMockAccessControl,
  deployMockPositionManager,
  deployMockPrimexLens,
  deployMockLimitOrderManager,
  deployMockBestDexLens,
} = require("./utils/waffleMocks");
const {
  getLimitPriceParams,
  getTakeProfitStopLossParams,
  getLimitPriceAdditionalParams,
  getCondition,
  getTakeProfitStopLossAdditionalParams,
} = require("./utils/conditionParams");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  setOraclePrice,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
} = require("./utils/oracleUtils");
const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  CloseReason,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  USD_MULTIPLIER,
  USD_DECIMALS,
} = require("./utils/constants");

process.env.TEST = true;
describe("PrimexUpkeep", function () {
  describe("PrimexUpkeep functionality", function () {
    let PrimexUpkeep, primexLens, bestDexLens, positionManager, limitOrderManager, ErrorsLibrary;
    let orderIdLiquidate, orderIdLiquidate2;
    let positionIdLiquidate, positionIdLiquidate2, dexesWithAncillaryData, ancillaryDexData;
    let deployer, trader, lender, dex;
    let snapshotId;
    let mockPositionManager, mockLimitOrderManager, mockRegistry, mockBestDexLens, mockPrimexLens;
    let testTokenA, testTokenB, PMXToken;
    let decimalsA, decimalsB, multiplierA, multiplierB;
    let bestRoutesPosToLiquidate, bestRoutesPosToLiquidate2, bestRoutesOrderToLiquidate, bestRoutesOrderToLiquidate2;
    let orderCOMAdditionalParams, order2COMAdditionalParams, conditionIndex;
    let priceOracle;

    before(async function () {
      await fixture(["Test"]);
      PrimexUpkeep = await getContract("PrimexUpkeep");
      positionManager = await getContract("PositionManager");
      limitOrderManager = await getContract("LimitOrderManager");
      ErrorsLibrary = await getContract("Errors");

      ({ deployer, trader, lender } = await getNamedSigners());

      testTokenA = await getContract("TestTokenA");
      testTokenB = await getContract("TestTokenB");
      PMXToken = await getContract("EPMXToken");
      decimalsA = await testTokenA.decimals();
      decimalsB = await testTokenB.decimals();
      multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

      const { payload } = await encodeFunctionData(
        "setMaxPositionSize",
        [testTokenA.address, testTokenB.address, 0, MaxUint256],
        "PositionManagerExtension",
      );
      await positionManager.setProtocolParamsByAdmin(payload);

      primexLens = await getContract("PrimexLens");
      bestDexLens = await getContract("BestDexLens");
      const PrimexDNS = await getContract("PrimexDNS");
      const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
      const bucket = await getContractAt("Bucket", bucketAddress);

      dex = process.env.DEX || "uniswap";

      checkIsDexSupported(dex);

      await addLiquidity({
        dex: dex,
        from: "lender",
        tokenA: testTokenA,
        tokenB: testTokenB,
        amountADesired: "1000000",
        amountBDesired: "1000000",
      });
      ancillaryDexData = await getAncillaryDexData({ dex });

      dexesWithAncillaryData = [
        {
          dex: dex,
          ancillaryData: ancillaryDexData,
        },
      ];
      priceOracle = await getContract("PriceOracle");

      await setupUsdOraclesForTokens(testTokenA, testTokenB, MaxUint256.div(2));
      await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), parseUnits("0.3", USD_DECIMALS));
      await setupUsdOraclesForTokens(testTokenB, await priceOracle.eth(), parseUnits("0.3", USD_DECIMALS));
      await setupUsdOraclesForTokens(PMXToken, await priceOracle.eth(), parseUnits("0.3", USD_DECIMALS));

      const lenderAmount = parseUnits("1000", decimalsA);
      const takeDepositFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256.div(2));
      await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256.div(2));

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
      // createLimitsOrder
      const depositAmount = parseUnits("10", decimalsA);
      const leverage = parseEther("2.5");
      await testTokenA.mint(trader.address, MaxUint256.div(2));

      const bigLimitPrice = MaxUint256.div(WAD);
      let deadline = new Date().getTime() + 600;
      // liquidator always can openPositionByOrder by this order
      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(bigLimitPrice))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      });
      orderIdLiquidate = await limitOrderManager.ordersId();
      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(bigLimitPrice))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      });
      orderIdLiquidate2 = await limitOrderManager.ordersId();

      // liquidator never can openPositionByOrder by this order
      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
        closeConditions: [],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      });

      // open positions
      deadline = new Date().getTime() + 600;
      const borrowedAmount = parseUnits("10", decimalsA);
      const amountOutMin = 0;
      const swapSize = depositAmount.add(borrowedAmount);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      let liquidationPrice = await primexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
        positionManager.address,
        "bucket1",
        borrowedAmount,
        testTokenB.address,
        amount0Out,
      );

      let takeProfitPrice = liquidationPrice.add(1).mul(multiplierA).toString();

      const assetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);
      // liquidator always can closePosition by limit
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        isProtocolFeeInPmx: false,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      const amount1Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      liquidationPrice = await primexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
        positionManager.address,
        "bucket1",
        borrowedAmount,
        testTokenB.address,
        amount1Out,
      );
      takeProfitPrice = liquidationPrice.add(1).mul(multiplierA).toString();
      positionIdLiquidate = 0;

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: assetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        isProtocolFeeInPmx: false,
        positionAsset: testTokenB.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      positionIdLiquidate2 = 1;

      // liquidator can't closePosition
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
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      });
      const swapSizeInWad = swapSize.mul(multiplierA);
      const amount0OutInWad = amount0Out.mul(multiplierB);
      const limitPriceInWad = wadDiv(amount0OutInWad.toString(), swapSizeInWad.toString()).toString();
      const limitPrice = BigNumber.from(limitPriceInWad).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenA, testTokenB, limitPrice);
      bestRoutesPosToLiquidate = (
        await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, positionIdLiquidate, 10, dexesWithAncillaryData)
      ).megaRoutes;
      bestRoutesPosToLiquidate2 = (
        await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, positionIdLiquidate2, 10, dexesWithAncillaryData)
      ).megaRoutes;
      bestRoutesOrderToLiquidate = await bestDexLens.callStatic.getBestDexByOrder([
        positionManager.address,
        limitOrderManager.address,
        orderIdLiquidate,
        { firstAssetShares: 10, depositInThirdAssetShares: 10, depositToBorrowedShares: 10 },
        dexesWithAncillaryData,
        [],
      ]);
      bestRoutesOrderToLiquidate2 = await bestDexLens.callStatic.getBestDexByOrder([
        positionManager.address,
        limitOrderManager.address,
        orderIdLiquidate2,
        { firstAssetShares: 10, depositInThirdAssetShares: 10, depositToBorrowedShares: 10 },
        dexesWithAncillaryData,
        [],
      ]);

      conditionIndex = 0;
      order2COMAdditionalParams = getLimitPriceAdditionalParams(
        bestRoutesOrderToLiquidate2.firstAssetReturnParams.megaRoutes,
        bestRoutesOrderToLiquidate2.depositInThirdAssetReturnParams.megaRoutes,
      );
      orderCOMAdditionalParams = getLimitPriceAdditionalParams(bestRoutesOrderToLiquidate.firstAssetReturnParams.megaRoutes, []);
    });

    beforeEach(async function () {
      mockPositionManager = await deployMockPositionManager(deployer);
      mockLimitOrderManager = await deployMockLimitOrderManager(deployer);
      mockPrimexLens = await deployMockPrimexLens(deployer);
      mockRegistry = await deployMockAccessControl(deployer);
      mockBestDexLens = await deployMockBestDexLens(deployer);

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
      let snapshotId, Registry, PrimexUpkeepFactory;
      before(async function () {
        Registry = await getContract("Registry");
        PrimexUpkeepFactory = await getContractFactory("PrimexUpkeep");
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

      it("Should deploy and initialize", async function () {
        const PrimexUpkeep = await PrimexUpkeepFactory.deploy(Registry.address);
        expect(await PrimexUpkeep.initialize(positionManager.address, limitOrderManager.address, bestDexLens.address, primexLens.address));
      });
      it("Should revert initialize when position manager address not supported", async function () {
        await mockPositionManager.mock.supportsInterface.returns(false);
        const PrimexUpkeep = await PrimexUpkeepFactory.deploy(Registry.address);
        await expect(
          PrimexUpkeep.initialize(mockPositionManager.address, limitOrderManager.address, bestDexLens.address, primexLens.address),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert initialize when limit order manager address not supported", async function () {
        await mockLimitOrderManager.mock.supportsInterface.returns(false);
        const PrimexUpkeep = await PrimexUpkeepFactory.deploy(Registry.address);
        await expect(
          PrimexUpkeep.initialize(positionManager.address, mockLimitOrderManager.address, bestDexLens.address, primexLens.address),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert deploy when registry address not supported", async function () {
        await mockRegistry.mock.supportsInterface.returns(false);
        await expect(PrimexUpkeepFactory.deploy(mockRegistry.address)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ADDRESS_NOT_SUPPORTED",
        );
      });

      it("Should revert deploy when bestDexLens address not supported", async function () {
        await mockBestDexLens.mock.supportsInterface.returns(false);
        const PrimexUpkeep = await PrimexUpkeepFactory.deploy(Registry.address);
        await expect(
          PrimexUpkeep.initialize(positionManager.address, limitOrderManager.address, mockBestDexLens.address, primexLens.address),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert deploy when primexLens address not supported", async function () {
        await mockPrimexLens.mock.supportsInterface.returns(false);
        const PrimexUpkeep = await PrimexUpkeepFactory.deploy(Registry.address);
        await expect(
          PrimexUpkeep.initialize(positionManager.address, limitOrderManager.address, bestDexLens.address, mockPrimexLens.address),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });
    });

    it("PrimexUpkeep close positions by performUpkeepPositions", async function () {
      const positionLiquidateInfo = {
        id: positionIdLiquidate,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: getTakeProfitStopLossAdditionalParams(
          bestRoutesPosToLiquidate,
          await getEncodedChainlinkRouteViaUsd(testTokenA),
        ),
        positionAssetMegaRoutes: bestRoutesPosToLiquidate,
        closeReason: CloseReason.LIMIT_CONDITION,
        positionSoldAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: await getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()),
        pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
      };

      const positionIdLiquidate2Info = {
        id: positionIdLiquidate2,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: getTakeProfitStopLossAdditionalParams(
          bestRoutesPosToLiquidate2,
          await getEncodedChainlinkRouteViaUsd(testTokenA),
        ),
        positionAssetMegaRoutes: bestRoutesPosToLiquidate2,
        closeReason: CloseReason.LIMIT_CONDITION,
        positionSoldAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: await getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()),
        pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
      };

      await PrimexUpkeep.performUpkeepPositions([positionLiquidateInfo, positionIdLiquidate2Info], deployer.address);

      await expect(positionManager.getPosition(positionIdLiquidate)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "POSITION_DOES_NOT_EXIST",
      );

      await expect(positionManager.getPosition(positionIdLiquidate2)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "POSITION_DOES_NOT_EXIST",
      );
    });

    it("PrimexUpkeep open positions by performUpkeepOrders", async function () {
      const orderToLiquidateInfo = {
        id: orderIdLiquidate,
        conditionIndex: conditionIndex,
        comAdditionalParams: orderCOMAdditionalParams,
        firstAssetMegaRoutes: bestRoutesOrderToLiquidate.firstAssetReturnParams.megaRoutes,
        depositInThirdAssetMegaRoutes: [],
        firstAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        nativePmxOracleData: await getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()),
        nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      };

      const orderToLiquidate2Info = {
        id: orderIdLiquidate2,
        conditionIndex: conditionIndex,
        comAdditionalParams: order2COMAdditionalParams,
        firstAssetMegaRoutes: bestRoutesOrderToLiquidate2.firstAssetReturnParams.megaRoutes,
        depositInThirdAssetMegaRoutes: [],
        firstAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        nativePmxOracleData: await getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()),
        nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
      };

      await PrimexUpkeep.performUpkeepOrdersUnsafe([orderToLiquidateInfo, orderToLiquidate2Info], deployer.address);
    });
  });
});
