// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  run,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits, defaultAbiCoder },
    constants: { MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const {
  addLiquidity,
  checkIsDexSupported,
  getAncillaryDexData,
  getAmountsOut,
  getAmountsIn,
  getSingleRoute,
} = require("./utils/dexOperations");
const { wadDiv, wadMul } = require("./utils/math");
const { parseArguments } = require("./utils/eventValidation");
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
const {
  WAD,
  OrderType,
  NATIVE_CURRENCY,
  MAX_TOKEN_DECIMALITY,
  ORDER_INFO_DECODE,
  POSITION_INFO_DECODE,
  CloseReason,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  USD,
} = require("./utils/constants");

process.env.TEST = true;
describe("PrimexUpkeep", function () {
  let openByOrderOutputSize, liquidationsOutputSize;
  describe("PrimexUpkeep functionality", function () {
    let PrimexUpkeep, primexLens, bestDexLens, positionManager, limitOrderManager, ErrorsLibrary;
    let orderIdLiquidate, orderIdLiquidate2, orderId2;
    let positionId2, positionIdLiquidate, positionIdLiquidate2, dexesWithAncillaryData, ancillaryDexData;
    let deployer, trader, lender, dex;
    let snapshotId;
    let mockPositionManager, mockLimitOrderManager, mockRegistry, mockBestDexLens, mockPrimexLens;
    let testTokenA, testTokenB, PMXToken;
    let decimalsA, decimalsB, multiplierA, multiplierB;
    let bestRoutesPosToLiquidate, bestRoutesPosToLiquidate2, bestRoutesOrderToLiquidate, bestRoutesOrderToLiquidate2;
    let orderCOMAdditionalParams, order2COMAdditionalParams, conditionIndex;
    let protocolRate, PriceInETH;

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

      await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

      primexLens = await getContract("PrimexLens");
      bestDexLens = await getContract("BestDexLens");
      const PrimexDNS = await getContract("PrimexDNS");
      const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
      const bucket = await getContractAt("Bucket", bucketAddress);

      protocolRate = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, NATIVE_CURRENCY);
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
      openByOrderOutputSize = 7;
      liquidationsOutputSize = 15;
      const tokenUSD = await getContract("USD Coin");
      const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
      const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_USD", deployer.address);
      await priceFeedTTBUSD.setAnswer(parseUnits("1", "8"));
      await priceFeedTTBUSD.setDecimals("8");
      const priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
      const priceOracle = await getContract("PriceOracle");
      await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);
      await priceOracle.updatePriceFeed(testTokenB.address, tokenUSD.address, priceFeedTTBUSD.address);

      const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
      PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
      await priceFeedTTAETH.setDecimals("18");
      await priceFeedTTAETH.setAnswer(PriceInETH);
      await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
      await priceOracle.updatePriceFeed(testTokenB.address, await priceOracle.eth(), priceFeedTTAETH.address);
      await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTAETH.address);

      const lenderAmount = parseUnits("1000", decimalsA);
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256.div(2));
      await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256.div(2));

      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender).deposit(lender.address, lenderAmount);

      // createLimitsOrder
      const depositAmount = parseUnits("10", decimalsA);
      const leverage = parseEther("2.5");
      await testTokenA.mint(trader.address, MaxUint256.div(2));

      let feeAmountCalculateWithETHRate = wadMul(
        wadMul(depositAmount.toString(), leverage.toString()).toString(),
        protocolRate.toString(),
      ).toString();
      let feeAmountInEth = wadMul(
        BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
        PriceInETH.toString(),
      ).toString();
      // isPositionRisky always false
      await priceFeed.setAnswer(MaxUint256.div(2));
      await priceFeed.setDecimals("18");
      const bigLimitPrice = MaxUint256.div(WAD);
      let deadline = new Date().getTime() + 600;
      // liquidator always can openPositionByOrder by this order
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
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(bigLimitPrice))],
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      orderIdLiquidate = await limitOrderManager.ordersId();

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
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(bigLimitPrice))],
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      orderIdLiquidate2 = await limitOrderManager.ordersId();

      // liquidator never can openPositionByOrder by this order
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
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      orderId2 = await limitOrderManager.ordersId();

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
      feeAmountCalculateWithETHRate = wadMul(swapSize.toString(), protocolRate.toString()).toString();
      feeAmountInEth = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(), PriceInETH.toString()).toString();

      const assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
      // liquidator always can closePosition by limit
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
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
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
        },
        { value: feeAmountInEth },
      );

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
      // liquidator always can closePosition by limit
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
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
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
        },
        { value: feeAmountInEth },
      );
      positionIdLiquidate2 = 1;

      // liquidator can't closePosition
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
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
        { value: feeAmountInEth },
      );

      // // isPositionRisky always false
      // const swapSize = depositAmount.add(borrowedAmount);
      // const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      positionId2 = 2;
      const swapSizeInWad = swapSize.mul(multiplierA);
      const amount0OutInWad = amount0Out.mul(multiplierB);
      const limitPriceInWad = wadDiv(swapSizeInWad.toString(), amount0OutInWad.toString()).toString();
      const limitPrice = BigNumber.from(limitPriceInWad).div(multiplierA);
      await priceFeed.setAnswer(limitPrice);
      await priceFeed.setDecimals(decimalsA);

      const bestRoutes2 = (
        await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, positionId2, 1, dexesWithAncillaryData)
      ).routes;
      bestRoutesPosToLiquidate = (
        await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, positionIdLiquidate, 10, dexesWithAncillaryData)
      ).routes;
      bestRoutesPosToLiquidate2 = (
        await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, positionIdLiquidate2, 10, dexesWithAncillaryData)
      ).routes;

      const statusPosition2 = await primexLens.callStatic.getPositionStatus(positionManager.address, positionId2, bestRoutes2);
      const statusPositionToLiquidate = await primexLens.callStatic.getPositionStatus(
        positionManager.address,
        positionIdLiquidate,
        bestRoutesPosToLiquidate,
      );

      const statusPositionToLiquidate2 = await primexLens.callStatic.getPositionStatus(
        positionManager.address,
        positionIdLiquidate2,
        bestRoutesPosToLiquidate2,
      );

      expect(statusPosition2.liquidationThreshold).to.equal(false);
      expect(statusPosition2.takeProfitReached).to.equal(false);
      expect(statusPosition2.stopLossReached).to.equal(false);

      expect(statusPositionToLiquidate.liquidationThreshold).to.equal(false);
      expect(statusPositionToLiquidate.takeProfitReached).to.equal(true);
      expect(statusPositionToLiquidate.stopLossReached).to.equal(false);

      expect(statusPositionToLiquidate2.liquidationThreshold).to.equal(false);
      expect(statusPositionToLiquidate2.takeProfitReached).to.equal(true);
      expect(statusPositionToLiquidate2.stopLossReached).to.equal(false);

      const bestRoutesOrderId2 = await bestDexLens.callStatic.getBestDexByOrder([
        positionManager.address,
        limitOrderManager.address,
        orderId2,
        { firstAssetShares: 10, depositInThirdAssetShares: 10, depositToBorrowedShares: 10 },
        dexesWithAncillaryData,
      ]);
      bestRoutesOrderToLiquidate = await bestDexLens.callStatic.getBestDexByOrder([
        positionManager.address,
        limitOrderManager.address,
        orderIdLiquidate,
        { firstAssetShares: 10, depositInThirdAssetShares: 10, depositToBorrowedShares: 10 },
        dexesWithAncillaryData,
      ]);
      bestRoutesOrderToLiquidate2 = await bestDexLens.callStatic.getBestDexByOrder([
        positionManager.address,
        limitOrderManager.address,
        orderIdLiquidate2,
        { firstAssetShares: 10, depositInThirdAssetShares: 10, depositToBorrowedShares: 10 },
        dexesWithAncillaryData,
      ]);

      conditionIndex = 0;

      expect(
        await limitOrderManager.callStatic.canBeFilled(
          orderId2,
          conditionIndex,
          getLimitPriceAdditionalParams(
            bestRoutesOrderId2.firstAssetReturnParams.routes,
            bestRoutesOrderId2.depositInThirdAssetReturnParams.routes,
            bestRoutesOrderId2.depositToBorrowedReturnParams.routes,
          ),
        ),
      ).to.equal(false);

      order2COMAdditionalParams = getLimitPriceAdditionalParams(
        bestRoutesOrderToLiquidate2.firstAssetReturnParams.routes,
        bestRoutesOrderToLiquidate2.depositInThirdAssetReturnParams.routes,
        bestRoutesOrderToLiquidate2.depositToBorrowedReturnParams.routes,
      );
      expect(await limitOrderManager.callStatic.canBeFilled(orderIdLiquidate2, conditionIndex, order2COMAdditionalParams)).to.equal(true);

      orderCOMAdditionalParams = getLimitPriceAdditionalParams(
        bestRoutesOrderToLiquidate.firstAssetReturnParams.routes,
        bestRoutesOrderToLiquidate.depositInThirdAssetReturnParams.routes,
        bestRoutesOrderToLiquidate.depositToBorrowedReturnParams.routes,
      );
      expect(await limitOrderManager.callStatic.canBeFilled(orderIdLiquidate, conditionIndex, orderCOMAdditionalParams)).to.equal(true);
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

      it("Should deploy", async function () {
        await PrimexUpkeepFactory.deploy(
          positionManager.address,
          limitOrderManager.address,
          Registry.address,
          bestDexLens.address,
          primexLens.address,
        );
      });
      it("Should revert deploy when position manager address not supported", async function () {
        await mockPositionManager.mock.supportsInterface.returns(false);
        await expect(
          PrimexUpkeepFactory.deploy(
            mockPositionManager.address,
            limitOrderManager.address,
            Registry.address,
            bestDexLens.address,
            primexLens.address,
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert deploy when limit order manager address not supported", async function () {
        await mockLimitOrderManager.mock.supportsInterface.returns(false);
        await expect(
          PrimexUpkeepFactory.deploy(
            positionManager.address,
            mockLimitOrderManager.address,
            Registry.address,
            bestDexLens.address,
            primexLens.address,
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert deploy when registry address not supported", async function () {
        await mockRegistry.mock.supportsInterface.returns(false);
        await expect(
          PrimexUpkeepFactory.deploy(
            positionManager.address,
            limitOrderManager.address,
            mockRegistry.address,
            bestDexLens.address,
            primexLens.address,
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert deploy when bestDexLens address not supported", async function () {
        await mockBestDexLens.mock.supportsInterface.returns(false);
        await expect(
          PrimexUpkeepFactory.deploy(
            positionManager.address,
            limitOrderManager.address,
            Registry.address,
            mockBestDexLens.address,
            primexLens.address,
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });

      it("Should revert deploy when primexLens address not supported", async function () {
        await mockPrimexLens.mock.supportsInterface.returns(false);
        await expect(
          PrimexUpkeepFactory.deploy(
            positionManager.address,
            limitOrderManager.address,
            Registry.address,
            bestDexLens.address,
            mockPrimexLens.address,
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });
    });
    it("Should revert deploy when liquidations output size is 0", async function () {
      const outputSize = 0;

      const liquidationSource = 1; // LiquidationSource for position
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      await expect(
        PrimexUpkeep.callStatic.checkUpkeep(
          checkData,
          [
            {
              dex: dex,
              ancillaryData: ancillaryDexData,
            },
          ],
          0,
          100,
          outputSize,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NUMBER_IS_0");
    });
    it("checkUpkeep return correct new cursor when amount position to close is liquidationsOutputSize and count positions are more liquidationsOutputSize ", async function () {
      const liquidationsOutputSize = 1;

      const liquidationSource = 1; // LiquidationSource for position
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      const upkeep = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        liquidationsOutputSize,
      );
      expect(upkeep.newCursor).to.equal(1);
    });
    it("checkUpkeep return correct new cursor when amount open position by order is openByOrderOutputSize and count orders are more openByOrderOutputSize", async function () {
      const openByOrderOutputSize = 1;

      const liquidationSource = 2;
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      const upkeep = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        openByOrderOutputSize,
      );
      expect(upkeep.newCursor).to.equal(1);
    });

    it("PrimexUpkeep flow for positions", async function () {
      const liquidationSource = 1; // LiquidationSource for position
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      const upkeep = await PrimexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
      expect(upkeep.newCursor).to.equal(0);

      expect(upkeep.upkeepNeeded).to.equal(true);
      const performData = upkeep.performData;

      const decodedDate = defaultAbiCoder.decode(POSITION_INFO_DECODE, performData);

      const liquidationSourceOut = decodedDate[0];
      const count = decodedDate[1];
      const toLiquidate = decodedDate[2];

      expect(toLiquidate.length).to.equal(liquidationsOutputSize);
      expect(liquidationSourceOut).to.equal(liquidationSource);
      expect(count).to.equal(2); // count positions to liquidate

      const positionToLiquidate = toLiquidate[0];
      const positionToLiquidate2 = toLiquidate[1];

      const positionLiquidateInfo = {
        id: positionIdLiquidate,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: await getTakeProfitStopLossAdditionalParams(bestRoutesPosToLiquidate),
        positionAssetRoutes: bestRoutesPosToLiquidate,
        closeReason: CloseReason.LIMIT_CONDITION,
      };

      parseArguments(positionToLiquidate, positionLiquidateInfo);

      const positionIdLiquidate2Info = {
        id: positionIdLiquidate2,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: await getTakeProfitStopLossAdditionalParams(bestRoutesPosToLiquidate2),
        positionAssetRoutes: bestRoutesPosToLiquidate2,
        closeReason: CloseReason.LIMIT_CONDITION,
      };
      parseArguments(positionToLiquidate2, positionIdLiquidate2Info);

      const defaultPositionInfo = {
        id: 0,
        conditionIndex: 0,
        ccmAdditionalParams: "0x",
        positionAssetRoutes: [],
        closeReason: 0,
      };
      for (let i = 2; i < toLiquidate.length; i++) {
        parseArguments(toLiquidate[i], defaultPositionInfo);
      }

      await PrimexUpkeep.performUpkeep(performData, deployer.address);

      const upkeep2 = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        liquidationsOutputSize,
      );
      expect(upkeep2.newCursor).to.equal(0);

      expect(upkeep2.upkeepNeeded).to.equal(false);
    });

    it("PrimexUpkeep flow for orders", async function () {
      const liquidationSource = 2; // LiquidationSource for order
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      const upkeep = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        openByOrderOutputSize,
      );
      expect(upkeep.newCursor).to.equal(0);

      expect(upkeep.upkeepNeeded).to.equal(true);
      const performData = upkeep.performData;

      const decodedDate = defaultAbiCoder.decode(ORDER_INFO_DECODE, performData);

      const liquidationSourceOut = decodedDate[0];
      const count = decodedDate[1];
      const toOpenByOrder = decodedDate[2];

      expect(toOpenByOrder.length).to.equal(openByOrderOutputSize);
      expect(liquidationSourceOut).to.equal(liquidationSource);
      expect(count).to.equal(2); // count orders to open

      const orderToLiquidate = toOpenByOrder[0];
      const orderToLiquidate2 = toOpenByOrder[1];

      const orderToLiquidateInfo = {
        id: orderIdLiquidate,
        conditionIndex: conditionIndex,
        comAdditionalParams: orderCOMAdditionalParams,
        firstAssetRoutes: bestRoutesOrderToLiquidate.firstAssetReturnParams.routes,
        depositInThirdAssetRoutes: [],
      };
      parseArguments(orderToLiquidate, orderToLiquidateInfo);

      const orderToLiquidate2Info = {
        id: orderIdLiquidate2,
        conditionIndex: conditionIndex,
        comAdditionalParams: order2COMAdditionalParams,
        firstAssetRoutes: bestRoutesOrderToLiquidate2.firstAssetReturnParams.routes,
        depositInThirdAssetRoutes: [],
      };

      parseArguments(orderToLiquidate2, orderToLiquidate2Info);

      const orderToLiquidateDeafultInfo = {
        id: 0,
        conditionIndex: 0,
        comAdditionalParams: "0x",
        firstAssetRoutes: [],
        depositInThirdAssetRoutes: [],
      };
      for (let i = 2; i < toOpenByOrder.length; i++) {
        parseArguments(toOpenByOrder[i], orderToLiquidateDeafultInfo);
      }

      await PrimexUpkeep.performUpkeep(performData, deployer.address);

      const upkeep2 = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        openByOrderOutputSize,
      );
      expect(upkeep2.newCursor).to.equal(0);

      expect(upkeep2.upkeepNeeded).to.equal(false);
    });

    it("PrimexUpkeep close positions by performUpkeepPositions", async function () {
      const liquidationSource = 1; // LiquidationSource for position
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      const upkeep = await PrimexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
      expect(upkeep.newCursor).to.equal(0);

      expect(upkeep.upkeepNeeded).to.equal(true);
      const performData = upkeep.performData;

      const decodedDate = defaultAbiCoder.decode(POSITION_INFO_DECODE, performData);

      const liquidationSourceOut = decodedDate[0];
      const count = decodedDate[1];
      const toLiquidate = decodedDate[2];

      expect(toLiquidate.length).to.equal(liquidationsOutputSize);
      expect(liquidationSourceOut).to.equal(liquidationSource);
      expect(count).to.equal(2); // count positions to liquidate

      const positionToLiquidate = toLiquidate[0];
      const positionToLiquidate2 = toLiquidate[1];

      const positionLiquidateInfo = {
        id: positionIdLiquidate,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: await getTakeProfitStopLossAdditionalParams(bestRoutesPosToLiquidate),
        positionAssetRoutes: bestRoutesPosToLiquidate,
        closeReason: CloseReason.LIMIT_CONDITION,
      };

      parseArguments(positionToLiquidate, positionLiquidateInfo);

      const positionIdLiquidate2Info = {
        id: positionIdLiquidate2,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: await getTakeProfitStopLossAdditionalParams(bestRoutesPosToLiquidate2),
        positionAssetRoutes: bestRoutesPosToLiquidate2,
        closeReason: CloseReason.LIMIT_CONDITION,
      };
      parseArguments(positionToLiquidate2, positionIdLiquidate2Info);

      const defaultPositionInfo = {
        id: 0,
        conditionIndex: 0,
        ccmAdditionalParams: "0x",
        positionAssetRoutes: [],
        closeReason: 0,
      };
      for (let i = 2; i < toLiquidate.length; i++) {
        parseArguments(toLiquidate[i], defaultPositionInfo);
      }

      await PrimexUpkeep.performUpkeepPositions(toLiquidate.slice(0, 2), deployer.address);

      const upkeep2 = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        liquidationsOutputSize,
      );
      expect(upkeep2.newCursor).to.equal(0);

      expect(upkeep2.upkeepNeeded).to.equal(false);
    });

    it("PrimexUpkeep open positions by performUpkeepOrders", async function () {
      const liquidationSource = 2; // LiquidationSource for order
      const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
      const upkeep = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        openByOrderOutputSize,
      );
      expect(upkeep.newCursor).to.equal(0);

      expect(upkeep.upkeepNeeded).to.equal(true);
      const performData = upkeep.performData;

      const decodedDate = defaultAbiCoder.decode(ORDER_INFO_DECODE, performData);

      const liquidationSourceOut = decodedDate[0];
      const count = decodedDate[1];
      const toOpenByOrder = decodedDate[2];

      expect(toOpenByOrder.length).to.equal(openByOrderOutputSize);
      expect(liquidationSourceOut).to.equal(liquidationSource);
      expect(count).to.equal(2); // count orders to open

      const orderToLiquidate = toOpenByOrder[0];
      const orderToLiquidate2 = toOpenByOrder[1];

      const orderToLiquidateInfo = {
        id: orderIdLiquidate,
        conditionIndex: conditionIndex,
        comAdditionalParams: orderCOMAdditionalParams,
        firstAssetRoutes: bestRoutesOrderToLiquidate.firstAssetReturnParams.routes,
        depositInThirdAssetRoutes: [],
      };
      parseArguments(orderToLiquidate, orderToLiquidateInfo);

      const orderToLiquidate2Info = {
        id: orderIdLiquidate2,
        conditionIndex: conditionIndex,
        comAdditionalParams: order2COMAdditionalParams,
        firstAssetRoutes: bestRoutesOrderToLiquidate2.firstAssetReturnParams.routes,
        depositInThirdAssetRoutes: [],
      };

      parseArguments(orderToLiquidate2, orderToLiquidate2Info);

      const orderToLiquidateDeafultInfo = {
        id: 0,
        conditionIndex: 0,
        comAdditionalParams: "0x",
        firstAssetRoutes: [],
        depositInThirdAssetRoutes: [],
      };
      for (let i = 2; i < toOpenByOrder.length; i++) {
        parseArguments(toOpenByOrder[i], orderToLiquidateDeafultInfo);
      }

      await PrimexUpkeep.performUpkeepOrders(toOpenByOrder.slice(0, 2), deployer.address);

      const upkeep2 = await PrimexUpkeep.callStatic.checkUpkeep(
        checkData,
        [
          {
            dex: dex,
            ancillaryData: ancillaryDexData,
          },
        ],
        0,
        100,
        openByOrderOutputSize,
      );
      expect(upkeep2.newCursor).to.equal(0);

      expect(upkeep2.upkeepNeeded).to.equal(false);
    });
  });

  describe("Splitter functionality", function () {
    let testTokenA, testTokenX, testTokenB, PMXToken;
    let decimalsA, decimalsB, decimalsX;
    let multiplierA, multiplierB, multiplierX;
    let bucket,
      bucketAddress,
      bestDexLens,
      primexLens,
      priceOracle,
      positionManager,
      limitOrderManager,
      primexPricingLibrary,
      deployer,
      trader,
      lender,
      primexUpkeep,
      PrimexAggregatorV3TestServiceFactory,
      dexes,
      snapshotId,
      ancillaryDataMap,
      protocolRate,
      PriceInETH;
    before(async function () {
      await fixture(["Test"]);
      primexUpkeep = await getContract("PrimexUpkeep");
      const PrimexDNS = await getContract("PrimexDNS");
      bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
      bucket = await getContractAt("Bucket", bucketAddress);
      priceOracle = await getContract("PriceOracle");
      bestDexLens = await getContract("BestDexLens");
      primexLens = await getContract("PrimexLens");
      PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
      positionManager = await getContract("PositionManager");
      limitOrderManager = await getContract("LimitOrderManager");
      primexPricingLibrary = await getContract("PrimexPricingLibrary");
      protocolRate = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, NATIVE_CURRENCY);

      ({ deployer, trader, lender } = await getNamedSigners());

      testTokenA = await getContract("TestTokenA");
      decimalsA = await testTokenA.decimals();

      testTokenB = await getContract("TestTokenB");
      decimalsB = await testTokenB.decimals();

      await run("deploy:ERC20Mock", {
        name: "TestTokenX",
        symbol: "TTX",
        decimals: "8",
        initialAccounts: JSON.stringify([]),
        initialBalances: JSON.stringify([]),
      });
      testTokenX = await getContract("TestTokenX");
      decimalsX = await testTokenX.decimals();

      await positionManager.setMaxPositionSize(testTokenA.address, testTokenX.address, 0, MaxUint256);

      multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

      PMXToken = await getContract("EPMXToken");

      // add tokenX to allowed assets
      const pairPriceDrop = BigNumber.from(WAD).div(100);
      await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);
      const priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
      await priceOracle.updatePriceFeed(testTokenX.address, USD, priceFeed.address);
      await bucket.addAsset(testTokenX.address);

      const lenderAmount = parseUnits("1000000", decimalsA);
      await testTokenA.mint(lender.address, parseUnits("1000000000", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, MaxUint256.div(2));
      await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256.div(2));
      await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
      await bucket.connect(lender).deposit(lender.address, lenderAmount);

      const dexAdapter = await getContract("DexAdapter");

      await testTokenA.mint(dexAdapter.address, parseUnits("1000000", decimalsA));
      await testTokenX.mint(dexAdapter.address, parseUnits("1000000", decimalsX));
      await testTokenB.mint(dexAdapter.address, parseUnits("1000000", decimalsB));

      dexes = ["uniswap", "uniswapv3", "balancer"];
      const tokenUSD = await getContract("USD Coin");
      const priceFeedTTXUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_USD", deployer.address);
      const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_USD", deployer.address);
      await priceFeedTTXUSD.setAnswer(parseUnits("1", "8"));
      await priceFeedTTXUSD.setDecimals("8");
      await priceFeedTTBUSD.setAnswer(parseUnits("1", "8"));
      await priceFeedTTBUSD.setDecimals("8");
      const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
      PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
      await priceFeedTTAETH.setDecimals("18");
      await priceFeedTTAETH.setAnswer(PriceInETH);
      await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
      await priceOracle.updatePriceFeed(testTokenB.address, tokenUSD.address, priceFeedTTBUSD.address);
      await priceOracle.updatePriceFeed(testTokenX.address, tokenUSD.address, priceFeedTTXUSD.address);
      await priceOracle.updatePriceFeed(testTokenX.address, await priceOracle.eth(), priceFeedTTXUSD.address);
      await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTAETH.address);
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

    describe("Deposit in a first asset", function () {
      let dexesWithAncillaryData, takeProfitPrice, firstAssetRoutes, positionAssetRoutes, feeAmountInEth;
      let limitPrice, depositAmountA, borrowedAmountA, liquidityAmount;
      let priceFeedAXdepositInFirst;
      const ancillaryDexData = [];

      before(async function () {
        // the ratio is close to the market
        // weights (for balancer) 3-3-4
        liquidityAmount = {
          tokenA: "4000",
          tokenX: "300",
          tokenB: "10249000",
        };
        depositAmountA = parseUnits("100", decimalsA);
        borrowedAmountA = parseUnits("100", decimalsA);
        await testTokenA.mint(trader.address, depositAmountA.mul(10));

        const feeAmountCalculateWithETHRate = wadMul(depositAmountA.add(borrowedAmountA).toString(), protocolRate.toString()).toString();
        feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
          PriceInETH.toString(),
        ).toString();

        // add liquidity to uniswap
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenX,
          tokenA: testTokenA,
          tokenB: testTokenX,
        });
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenA,
          tokenB: testTokenB,
        });
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: liquidityAmount.tokenX,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenX,
          tokenB: testTokenB,
        });

        // add liquidity to uniswapv3
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenX,
          tokenA: testTokenA,
          tokenB: testTokenX,
        });
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenA,
          tokenB: testTokenB,
        });
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: liquidityAmount.tokenX,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenX,
          tokenB: testTokenB,
        });

        // add liquidity to balancer
        const poolBalancer = await addLiquidity({
          dex: dexes[2],
          from: "lender",
          assets: [
            { token: testTokenA.address, weight: "3", amount: liquidityAmount.tokenA },
            { token: testTokenX.address, weight: "3", amount: liquidityAmount.tokenX },
            { token: testTokenB.address, weight: "4", amount: liquidityAmount.tokenB },
          ],
        });

        // set the ancillary data
        ancillaryDexData[0] = await getAncillaryDexData({ dex: dexes[0] });
        ancillaryDexData[1] = await getAncillaryDexData({ dex: dexes[1] });
        ancillaryDexData[2] = await getAncillaryDexData({ dex: dexes[2], pool: poolBalancer });

        dexesWithAncillaryData = [
          {
            dex: dexes[0],
            ancillaryData: ancillaryDexData[0],
          },
          {
            dex: dexes[1],
            ancillaryData: ancillaryDexData[1],
          },
          {
            dex: dexes[2],
            ancillaryData: ancillaryDexData[2],
          },
        ];

        ancillaryDataMap = {
          [dexes[1]]: [ancillaryDexData[1]],
          [dexes[2]]: [poolBalancer],
        };

        priceFeedAXdepositInFirst = await PrimexAggregatorV3TestServiceFactory.deploy(
          "PrimexAggregatorV3TestService_AX_depositInFirst",
          deployer.address,
        );
        await priceOracle.updatePriceFeed(testTokenX.address, testTokenA.address, priceFeedAXdepositInFirst.address);

        const sharesAmount = 10;

        // calculate firstAssetRoutes
        firstAssetRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenX.address,
            assetToSell: testTokenA.address,
            amount: depositAmountA,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(firstAssetRoutes.length).to.be.gt(1);

        // calculate positionAssetRoutes
        positionAssetRoutes = firstAssetRoutes;

        // set priceFeedAXdepositInFirst
        const amountA = depositAmountA.add(borrowedAmountA);
        const amountAInOneShare = amountA.div(sharesAmount);
        let amountX = BigNumber.from(0);
        for (let i = 0; i < firstAssetRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            firstAssetRoutes[i].paths[0].dexName,
            amountAInOneShare.mul(firstAssetRoutes[i].shares),
            [testTokenA.address, testTokenX.address],
            ancillaryDataMap[firstAssetRoutes[i].paths[0].dexName],
          );
          amountX = amountX.add(amountOutFromDex);
        }
        const amountAinWadDecimals = amountA.mul(multiplierA);
        const amountXinWadDecimals = amountX.mul(multiplierX);
        let priceXA = wadDiv(amountAinWadDecimals.toString(), amountXinWadDecimals.toString()).toString();
        priceXA = BigNumber.from(priceXA).div(multiplierA);
        await priceFeedAXdepositInFirst.setAnswer(priceXA);
        await priceFeedAXdepositInFirst.setDecimals(decimalsA);

        // limitPrice
        limitPrice = priceXA.mul(10);

        // calculate liquidationPrice and takeProfitPrice
        const liquidationPrice = await primexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
          positionManager.address,
          "bucket1",
          borrowedAmountA,
          testTokenX.address,
          amountX,
        );
        takeProfitPrice = liquidationPrice.add(1).mul(multiplierA).toString();
      });

      it("Should close position by condition on multiple dexes - deposit in a first asset", async function () {
        const deadline = new Date().getTime() + 600;

        // create a position
        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmountA,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenA.address,
            depositAmount: depositAmountA,
            positionAsset: testTokenX.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: true,
            payFeeFromWallet: true,
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
          },
          { value: feeAmountInEth },
        );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

        // find perform data
        const liquidationSource = 1; // LiquidationSource for position
        const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
        const upkeep = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep.newCursor).to.equal(0);
        expect(upkeep.upkeepNeeded).to.equal(true);
        const performData = upkeep.performData;

        // decode performData
        const decodedData = defaultAbiCoder.decode(POSITION_INFO_DECODE, performData);

        // check positionId and positionAssetRoutes
        const toLiquidate = decodedData[2];
        const id = toLiquidate[0][0];
        const position = await positionManager.getPosition(0);
        expect(id).to.equal(position.id);

        const positionAssetRoutesDecoded = toLiquidate[0][3];
        expect(positionAssetRoutesDecoded.length).to.be.gt(1);
        expect(positionAssetRoutesDecoded.length).to.equal(positionAssetRoutes.length);

        // liquidate position
        await primexUpkeep.performUpkeep(performData, deployer.address);

        // checkUpkeep
        const upkeep2 = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep2.newCursor).to.equal(0);
        expect(upkeep2.upkeepNeeded).to.equal(false);
      });

      it("Should open position by order on multiple dexes - deposit in a first asset", async function () {
        const deadline = new Date().getTime() + 600;
        const leverage = parseEther("2.5");

        const feeAmountCalculateWithETHRate = wadMul(
          wadMul(depositAmountA.toString(), leverage.toString()).toString(),
          protocolRate.toString(),
        ).toString();
        const feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
          PriceInETH.toString(),
        ).toString();
        // create limit order
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenA.address,
            depositAmount: depositAmountA,
            positionAsset: testTokenX.address,
            deadline: deadline,
            takeDepositFromWallet: true,
            payFeeFromWallet: true,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        // find perform data
        const liquidationSource = 2; // LiquidationSource for order
        const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
        const upkeep = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep.newCursor).to.equal(0);
        expect(upkeep.upkeepNeeded).to.equal(true);
        const performData = upkeep.performData;

        // decode performData
        const decodedDate = defaultAbiCoder.decode(ORDER_INFO_DECODE, performData);

        const liquidationSourceDecoded = decodedDate[0];
        const countDecoded = decodedDate[1];
        const toOpenByOrder = decodedDate[2];
        expect(liquidationSourceDecoded).to.equal(liquidationSource);
        expect(countDecoded).to.equal(1);

        // check firstAssetRoutes amount
        const firstAssetRoutesDecoded = toOpenByOrder[0][3];
        expect(firstAssetRoutesDecoded.length).to.equal(firstAssetRoutes.length);
        expect(firstAssetRoutesDecoded.length).to.be.gt(1);

        // check depositInThirdAssetRoutes amount
        const depositInThirdAssetRoutesDecoded = toOpenByOrder[0][4];
        expect(depositInThirdAssetRoutesDecoded.length).to.equal(0);

        // open position by order
        await primexUpkeep.performUpkeep(performData, deployer.address);

        // check upkeep
        const upkeep2 = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep2.upkeepNeeded).to.equal(false);
      });
    });

    describe("Deposit in a second asset", function () {
      let dexesWithAncillaryData, takeProfitPrice;
      let limitPrice, depositAmountX, borrowedAmountA, liquidityAmount, leverage, positionAmount, borrowedAmountInX;
      let priceFeedAXdepositInSecond, priceForPositionClose;
      let firstAssetRoutes, depositToBorrowedRoutes, positionAssetRoutes;
      const ancillaryDexData = [];

      before(async function () {
        // the ratio is close to the market
        // weights (for balancer) 3-3-4
        liquidityAmount = {
          tokenA: "4000",
          tokenX: "300",
          tokenB: "10249000",
        };
        depositAmountX = parseUnits("100", decimalsX);
        await testTokenX.connect(trader).approve(limitOrderManager.address, depositAmountX.mul(10));
        await testTokenX.connect(trader).approve(positionManager.address, MaxUint256.div(2));
        await testTokenX.mint(trader.address, depositAmountX.mul(10));

        // add liquidity to uniswap
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenX,
          tokenA: testTokenA,
          tokenB: testTokenX,
        });
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenA,
          tokenB: testTokenB,
        });
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: liquidityAmount.tokenX,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenX,
          tokenB: testTokenB,
        });

        // add liquidity to uniswapv3
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenX,
          tokenA: testTokenA,
          tokenB: testTokenX,
        });
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: liquidityAmount.tokenA,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenA,
          tokenB: testTokenB,
        });
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: liquidityAmount.tokenX,
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenX,
          tokenB: testTokenB,
        });
        // add liquidity to balancer
        const poolBalancer = await addLiquidity({
          dex: dexes[2],
          from: "lender",
          assets: [
            { token: testTokenA.address, weight: "3", amount: liquidityAmount.tokenA },
            { token: testTokenX.address, weight: "3", amount: liquidityAmount.tokenX },
            { token: testTokenB.address, weight: "4", amount: liquidityAmount.tokenB },
          ],
        });

        // set the ancillary data
        ancillaryDexData[0] = await getAncillaryDexData({ dex: dexes[0] });
        ancillaryDexData[1] = await getAncillaryDexData({ dex: dexes[1] });
        ancillaryDexData[2] = await getAncillaryDexData({ dex: dexes[2], pool: poolBalancer });

        dexesWithAncillaryData = [
          {
            dex: dexes[0],
            ancillaryData: ancillaryDexData[0],
          },
          {
            dex: dexes[1],
            ancillaryData: ancillaryDexData[1],
          },
          {
            dex: dexes[2],
            ancillaryData: ancillaryDexData[2],
          },
        ];

        ancillaryDataMap = {
          [dexes[1]]: [ancillaryDexData[1]],
          [dexes[2]]: [poolBalancer],
        };

        priceFeedAXdepositInSecond = await PrimexAggregatorV3TestServiceFactory.deploy(
          "PrimexAggregatorV3TestService_AX_depositInSecond",
          deployer.address,
        );
        const tokenUSD = await getContract("USD Coin");
        const priceFeedTTXUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_USD", deployer.address);
        await priceFeedTTXUSD.setAnswer(parseUnits("1", "8"));
        await priceFeedTTXUSD.setDecimals("8");
        await priceOracle.updatePriceFeed(testTokenX.address, testTokenA.address, priceFeedAXdepositInSecond.address);
        await priceOracle.updatePriceFeed(testTokenX.address, tokenUSD.address, priceFeedTTXUSD.address);

        const priceFeedTTXETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_ETH", deployer.address);
        PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
        await priceFeedTTXETH.setDecimals("18");
        await priceFeedTTXETH.setAnswer(PriceInETH);
        await priceOracle.updatePriceFeed(testTokenX.address, await priceOracle.eth(), priceFeedTTXETH.address);

        const sharesAmount = 10;
        leverage = parseEther("2.5");

        // calculate depositToBorrowedRoutes
        depositToBorrowedRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenA.address,
            assetToSell: testTokenX.address,
            amount: depositAmountX,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(depositToBorrowedRoutes.length).to.be.gt(1);

        const swapAmountX = BigNumber.from(wadMul(depositAmountX.toString(), leverage.sub(WAD).toString()).toString());
        const amountXInOneShare = swapAmountX.div(sharesAmount);
        let amountAFromDex = BigNumber.from(0);

        for (let i = 0; i < depositToBorrowedRoutes.length; i++) {
          const dexName = depositToBorrowedRoutes[i].paths[0].dexName;
          const path = dexName === "uniswapv3" ? [testTokenX.address, testTokenA.address] : [testTokenA.address, testTokenX.address];
          const amountOutFromDex = await getAmountsIn(
            depositToBorrowedRoutes[i].paths[0].dexName,
            amountXInOneShare.mul(depositToBorrowedRoutes[i].shares),
            path,
            ancillaryDataMap[depositToBorrowedRoutes[i].paths[0].dexName],
          );
          amountAFromDex = amountAFromDex.add(amountOutFromDex);
        }

        const swapAmountXInWad = swapAmountX.mul(multiplierX);
        const swapAmountAInWad = amountAFromDex.mul(multiplierA);
        let priceXA = wadDiv(swapAmountAInWad.toString(), swapAmountXInWad.toString()).toString();
        priceXA = BigNumber.from(priceXA).div(multiplierA);
        await priceFeedAXdepositInSecond.setAnswer(priceXA);
        await priceFeedAXdepositInSecond.setDecimals(decimalsA);

        const amountA = await primexPricingLibrary.getOracleAmountsOut(
          testTokenX.address,
          testTokenA.address,
          depositAmountX,
          priceOracle.address,
        );

        const amountAinWadDecimals = amountA.mul(multiplierA);
        const amountXinWadDecimals = depositAmountX.mul(multiplierX);

        // limitPrice
        limitPrice = wadDiv(amountAinWadDecimals.toString(), amountXinWadDecimals.toString()).toString();
        limitPrice = BigNumber.from(limitPrice).div(multiplierA).mul(10);

        // calculate firstAssetRoutes
        borrowedAmountA = wadMul(amountA.toString(), leverage.toString()).toString();
        borrowedAmountA = BigNumber.from(borrowedAmountA).sub(amountA);

        firstAssetRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenX.address,
            assetToSell: testTokenA.address,
            amount: borrowedAmountA,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(firstAssetRoutes.length).to.be.gt(1);

        const amountAInOneShare = borrowedAmountA.div(sharesAmount);
        borrowedAmountInX = BigNumber.from(0);
        for (let i = 0; i < firstAssetRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            firstAssetRoutes[i].paths[0].dexName,
            amountAInOneShare.mul(firstAssetRoutes[i].shares),
            [testTokenA.address, testTokenX.address],
            ancillaryDataMap[firstAssetRoutes[i].paths[0].dexName],
          );
          borrowedAmountInX = borrowedAmountInX.add(amountOutFromDex);
        }

        positionAmount = depositAmountX.add(borrowedAmountInX);

        // calculate positionAssetRoutes
        positionAssetRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenA.address,
            assetToSell: testTokenX.address,
            amount: positionAmount,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(positionAssetRoutes.length).to.be.gt(1);

        const positionAmountInOneShare = positionAmount.div(sharesAmount);
        let amountAreturned = BigNumber.from(0);
        for (let i = 0; i < positionAssetRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            positionAssetRoutes[i].paths[0].dexName,
            positionAmountInOneShare.mul(positionAssetRoutes[i].shares),
            [testTokenX.address, testTokenA.address],
            ancillaryDataMap[positionAssetRoutes[i].paths[0].dexName],
          );
          amountAreturned = amountAreturned.add(amountOutFromDex);
        }

        const positionAmountInWad = positionAmount.mul(multiplierX);
        const amountAreturnedInWad = amountAreturned.mul(multiplierA);

        priceForPositionClose = wadDiv(amountAreturnedInWad.toString(), positionAmountInWad.toString()).toString();
        priceForPositionClose = BigNumber.from(priceForPositionClose).div(multiplierA);

        // liquidationPrice
        const liquidationPrice = await primexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
          positionManager.address,
          "bucket1",
          borrowedAmountA,
          testTokenX.address,
          positionAmount,
        );

        // takeProfitPrice
        takeProfitPrice = liquidationPrice.add(1).mul(multiplierA).toString();
      });

      it("Should close position by condition on multiple dexes - deposit in a second asset", async function () {
        const deadline = new Date().getTime() + 600;
        const feeAmountCalculateWithETHRate = wadMul(positionAmount.toString(), protocolRate.toString()).toString();
        const feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierX).toString(),
          PriceInETH.toString(),
        ).toString();
        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmountA,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenX.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: true,
            payFeeFromWallet: true,
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
          },
          { value: feeAmountInEth },
        );
        await priceFeedAXdepositInSecond.setAnswer(priceForPositionClose);
        await priceFeedAXdepositInSecond.setDecimals(decimalsA);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

        // find perform data
        const liquidationSource = 1; // LiquidationSource for position
        const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
        const upkeep = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep.newCursor).to.equal(0);
        expect(upkeep.upkeepNeeded).to.equal(true);
        const performData = upkeep.performData;

        // decode performData
        const decodedData = defaultAbiCoder.decode(POSITION_INFO_DECODE, performData);

        // check positionId and positionAssetRoutes
        const toLiquidate = decodedData[2];
        const id = toLiquidate[0][0];
        const position = await positionManager.getPosition(id);
        expect(id).to.equal(position.id);

        const positionAssetRoutesDecoded = toLiquidate[0][3];
        expect(positionAssetRoutesDecoded.length).to.be.gt(1);
        expect(positionAssetRoutesDecoded.length).to.equal(positionAssetRoutes.length);

        // liquidate position
        await primexUpkeep.performUpkeep(performData, deployer.address);

        // checkUpkeep
        const upkeep2 = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep2.newCursor).to.equal(0);
        expect(upkeep2.upkeepNeeded).to.equal(false);
      });

      it("Should open position by order on multiple dexes - deposit in a second asset", async function () {
        const deadline = new Date().getTime() + 600;
        const depositAmount = parseUnits("50", decimalsX);

        const feeAmountCalculateWithETHRate = wadMul(
          wadMul(depositAmount.toString(), leverage.toString()),
          protocolRate.toString(),
        ).toString();

        const feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierX).toString(),
          PriceInETH.toString(),
        ).toString();
        // create limit order
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenX.address,
            depositAmount: depositAmount,
            positionAsset: testTokenX.address,
            deadline: deadline,
            takeDepositFromWallet: true,
            payFeeFromWallet: true,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        // find perform data
        const liquidationSource = 2; // LiquidationSource for order
        const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
        const upkeep = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, openByOrderOutputSize);
        expect(upkeep.newCursor).to.equal(0);
        expect(upkeep.upkeepNeeded).to.equal(true);
        const performData = upkeep.performData;

        // decode performData
        const decodedDate = defaultAbiCoder.decode(ORDER_INFO_DECODE, performData);

        const liquidationSourceDecoded = decodedDate[0];
        const count = decodedDate[1];
        const toOpenByOrder = decodedDate[2];

        expect(liquidationSourceDecoded).to.equal(liquidationSource);
        expect(count).to.equal(1);

        // check firstAssetRoutes amount
        const firstAssetRoutesDecoded = toOpenByOrder[0][3];
        expect(firstAssetRoutesDecoded.length).to.equal(firstAssetRoutes.length);
        expect(firstAssetRoutesDecoded.length).to.be.gt(1);

        // check depositInThirdAssetRoutes amount
        const depositInThirdAssetRoutesDecoded = toOpenByOrder[0][4];
        expect(depositInThirdAssetRoutesDecoded.length).to.equal(0);

        // open position by order
        await primexUpkeep.performUpkeep(performData, deployer.address);

        // check upkeep
        const upkeep2 = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, openByOrderOutputSize);
        expect(upkeep2.upkeepNeeded).to.equal(false);
      });
    });

    describe("Deposit in a third asset", function () {
      let depositAmountB, dexesWithAncillaryData;
      let priceFeedBA, priceFeedBX, priceFeedAXdepositInThird;
      let depositInThirdAssetRoutes, depositToBorrowedRoutes, firstAssetRoutes, positionAssetRoutes;
      let leverage, exchangeBXrate, exchangeBArate, limitPriceA, borrowedAmountA, takeProfitPrice, liquidityAmount, depositAmountA;
      const ancillaryDexData = [];

      before(async function () {
        await fixture(["Test"]);
        primexUpkeep = await getContract("PrimexUpkeep");
        const PrimexDNS = await getContract("PrimexDNS");
        bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
        bucket = await getContractAt("Bucket", bucketAddress);
        priceOracle = await getContract("PriceOracle");
        bestDexLens = await getContract("BestDexLens");
        primexLens = await getContract("PrimexLens");
        PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
        positionManager = await getContract("PositionManager");
        limitOrderManager = await getContract("LimitOrderManager");

        ({ deployer, trader, lender } = await getNamedSigners());

        testTokenA = await getContract("TestTokenA");
        decimalsA = await testTokenA.decimals();

        testTokenB = await getContract("TestTokenB");
        decimalsB = await testTokenB.decimals();

        await run("deploy:ERC20Mock", {
          name: "TestTokenX",
          symbol: "TTX",
          decimals: "8",
          initialAccounts: JSON.stringify([]),
          initialBalances: JSON.stringify([]),
        });
        testTokenX = await getContract("TestTokenX");
        decimalsX = await testTokenX.decimals();

        await positionManager.setMaxPositionSize(testTokenA.address, testTokenX.address, 0, MaxUint256);

        multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
        multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
        multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

        // add tokenX to allowed assets
        const pairPriceDrop = BigNumber.from(WAD).div(100);

        await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);
        const priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
        await priceOracle.updatePriceFeed(testTokenX.address, USD, priceFeed.address);

        await bucket.addAsset(testTokenX.address);

        const lenderAmount = parseUnits("1000000", decimalsA);
        await testTokenA.mint(lender.address, parseUnits("1000000000", decimalsA));
        await testTokenA.connect(trader).approve(positionManager.address, MaxUint256.div(2));
        await testTokenA.connect(trader).approve(limitOrderManager.address, MaxUint256.div(2));
        await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
        await bucket.connect(lender).deposit(lender.address, lenderAmount);

        const dexAdapter = await getContract("DexAdapter");

        await testTokenA.mint(dexAdapter.address, parseUnits("1000000", decimalsA));
        await testTokenX.mint(dexAdapter.address, parseUnits("1000000", decimalsX));
        await testTokenB.mint(dexAdapter.address, parseUnits("1000000", decimalsB));

        dexes = ["uniswap", "uniswapv3", "balancer"];

        // the ratio is close to the market
        // weights (for balancer) 3-3-4
        liquidityAmount = {
          tokenA: "4000",
          tokenX: "300",
          tokenB: "1024",
        };

        // add liquidity to uniswap
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: BigNumber.from(liquidityAmount.tokenA).toString(),
          amountBDesired: BigNumber.from(liquidityAmount.tokenX).toString(),
          tokenA: testTokenA,
          tokenB: testTokenX,
        });
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: BigNumber.from(liquidityAmount.tokenA).toString(),
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenA,
          tokenB: testTokenB,
        });
        await addLiquidity({
          dex: dexes[0],
          from: "lender",
          amountADesired: BigNumber.from(liquidityAmount.tokenX).toString(),
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenX,
          tokenB: testTokenB,
        });

        // add liquidity to uniswapv3
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: BigNumber.from(liquidityAmount.tokenA).toString(),
          amountBDesired: BigNumber.from(liquidityAmount.tokenX).toString(),
          tokenA: testTokenA,
          tokenB: testTokenX,
        });
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: BigNumber.from(liquidityAmount.tokenA).toString(),
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenA,
          tokenB: testTokenB,
        });
        await addLiquidity({
          dex: dexes[1],
          from: "lender",
          amountADesired: BigNumber.from(liquidityAmount.tokenX).toString(),
          amountBDesired: liquidityAmount.tokenB,
          tokenA: testTokenX,
          tokenB: testTokenB,
        });

        // add liquidity to balancer
        const poolBalancer = await addLiquidity({
          dex: dexes[2],
          from: "lender",
          assets: [
            { token: testTokenA.address, weight: "3", amount: liquidityAmount.tokenA },
            { token: testTokenX.address, weight: "3", amount: liquidityAmount.tokenX },
            { token: testTokenB.address, weight: "4", amount: liquidityAmount.tokenB },
          ],
        });

        // set the ancillary data
        ancillaryDexData[0] = await getAncillaryDexData({ dex: dexes[0] });
        ancillaryDexData[1] = await getAncillaryDexData({ dex: dexes[1] });
        ancillaryDexData[2] = await getAncillaryDexData({ dex: dexes[2], pool: poolBalancer });

        dexesWithAncillaryData = [
          {
            dex: dexes[0],
            ancillaryData: ancillaryDexData[0],
          },
          {
            dex: dexes[1],
            ancillaryData: ancillaryDexData[1],
          },
        ];

        ancillaryDataMap = {
          [dexes[1]]: [ancillaryDexData[1]],
          [dexes[2]]: [poolBalancer],
        };

        depositAmountB = parseUnits("100", decimalsB);
        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB.mul(10));
        await testTokenB.connect(trader).approve(positionManager.address, MaxUint256.div(2));

        await testTokenB.mint(trader.address, depositAmountB.mul(10));
        leverage = parseEther("2.5");
        const sharesAmount = 10;
        const amountBInOneShare = depositAmountB.div(sharesAmount);

        // calculate depositToBorrowedRoutes
        depositToBorrowedRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenA.address,
            assetToSell: testTokenB.address,
            amount: depositAmountB,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;

        expect(depositToBorrowedRoutes.length).to.be.gt(1);

        priceFeedBA = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService_BA", deployer.address);
        const tokenUSD = await getContract("USD Coin");
        const priceFeedTTXUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_USD", deployer.address);
        await priceFeedTTXUSD.setAnswer(parseUnits("1", "8"));
        await priceFeedTTXUSD.setDecimals("8");
        await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeedBA.address);
        await priceOracle.updatePriceFeed(testTokenX.address, tokenUSD.address, priceFeedTTXUSD.address);

        const priceFeedTTXETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_ETH", deployer.address);
        const priceFeedTTBETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_ETH", deployer.address);
        PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
        await priceFeedTTXETH.setDecimals("18");
        await priceFeedTTXETH.setAnswer(PriceInETH);
        await priceOracle.updatePriceFeed(testTokenX.address, await priceOracle.eth(), priceFeedTTXETH.address);

        await priceFeedTTBETH.setDecimals("18");
        await priceFeedTTBETH.setAnswer(PriceInETH);
        await priceOracle.updatePriceFeed(testTokenB.address, await priceOracle.eth(), priceFeedTTBETH.address);
        await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTBETH.address);

        depositAmountA = BigNumber.from(0);
        for (let i = 0; i < depositToBorrowedRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            depositToBorrowedRoutes[i].paths[0].dexName,
            amountBInOneShare.mul(depositToBorrowedRoutes[i].shares),
            [testTokenB.address, testTokenA.address],
            ancillaryDataMap[depositToBorrowedRoutes[i].paths[0].dexName],
          );
          depositAmountA = depositAmountA.add(amountOutFromDex);
        }
        const depositAmountBInWadDecimals = depositAmountB.mul(multiplierB);
        const depositAmountAInWadDecimals = depositAmountA.mul(multiplierA);
        const priceBA = wadDiv(depositAmountAInWadDecimals.toString(), depositAmountBInWadDecimals.toString()).toString();
        exchangeBArate = BigNumber.from(priceBA).div(multiplierA);
        await priceFeedBA.setAnswer(exchangeBArate);
        await priceFeedBA.setDecimals(decimalsA);

        // calculate depositInThirdAssetRoutes
        depositInThirdAssetRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenX.address,
            assetToSell: testTokenB.address,
            amount: depositAmountB,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(depositInThirdAssetRoutes.length).to.be.gt(1);

        priceFeedBX = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService_BX", deployer.address);
        await priceOracle.updatePriceFeed(testTokenB.address, testTokenX.address, priceFeedBX.address);
        let amountXOutDeposit = BigNumber.from(0);
        for (let i = 0; i < depositInThirdAssetRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            depositInThirdAssetRoutes[i].paths[0].dexName,
            amountBInOneShare.mul(depositInThirdAssetRoutes[i].shares),
            [testTokenB.address, testTokenX.address],
            ancillaryDataMap[depositInThirdAssetRoutes[i].paths[0].dexName],
          );
          amountXOutDeposit = amountXOutDeposit.add(amountOutFromDex);
        }

        const amountXOutDepositInWadDecimals = amountXOutDeposit.mul(multiplierX);
        const priceBX = wadDiv(amountXOutDepositInWadDecimals.toString(), depositAmountBInWadDecimals.toString()).toString();
        exchangeBXrate = BigNumber.from(priceBX).div(multiplierX);
        await priceFeedBX.setAnswer(exchangeBXrate);
        await priceFeedBX.setDecimals(decimalsX);

        // calculate firstAssetRoutes
        const amountIn = wadMul(depositAmountA.toString(), leverage.toString()).toString();

        const amountToTransfer = BigNumber.from(amountIn).sub(depositAmountA);
        borrowedAmountA = amountToTransfer;
        const amountAInOneShare = amountToTransfer.div(sharesAmount);

        firstAssetRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenX.address,
            assetToSell: testTokenA.address,
            amount: amountToTransfer,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(firstAssetRoutes.length).to.be.gt(1);

        let borrowAmountInX = BigNumber.from(0);
        for (let i = 0; i < firstAssetRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            firstAssetRoutes[i].paths[0].dexName,
            amountAInOneShare.mul(firstAssetRoutes[i].shares),
            [testTokenA.address, testTokenX.address],
            ancillaryDataMap[firstAssetRoutes[i].paths[0].dexName],
          );
          borrowAmountInX = borrowAmountInX.add(amountOutFromDex);
        }
        const amountXInWadDecimals = borrowAmountInX.mul(multiplierX);
        const amountAInWadDecimals = amountToTransfer.mul(multiplierA);

        let priceXA = BigNumber.from(wadDiv(amountAInWadDecimals.toString(), amountXInWadDecimals.toString()).toString());
        priceXA = priceXA.div(multiplierA);
        priceFeedAXdepositInThird = await PrimexAggregatorV3TestServiceFactory.deploy(
          "PrimexAggregatorV3TestService_AX_depositInThird",
          deployer.address,
        );
        await priceOracle.updatePriceFeed(testTokenX.address, testTokenA.address, priceFeedAXdepositInThird.address);
        await priceFeedAXdepositInThird.setAnswer(priceXA);
        await priceFeedAXdepositInThird.setDecimals(decimalsA);

        // calculate positionAssetRoutes
        const positionAmount = borrowAmountInX.add(amountXOutDeposit);
        const amountInInOneShare = BigNumber.from(amountIn).div(sharesAmount);

        positionAssetRoutes = (
          await bestDexLens.callStatic.getBestMultipleDexes({
            positionManager: positionManager.address,
            assetToBuy: testTokenA.address,
            assetToSell: testTokenX.address,
            amount: positionAmount,
            isAmountToBuy: false,
            shares: sharesAmount,
            gasPriceInCheckedAsset: 0,
            dexes: dexesWithAncillaryData,
          })
        ).routes;
        expect(positionAssetRoutes.length).to.be.gt(1);

        let amountAreturned = BigNumber.from(0);
        for (let i = 0; i < positionAssetRoutes.length; i++) {
          const amountOutFromDex = await getAmountsOut(
            positionAssetRoutes[i].paths[0].dexName,
            amountInInOneShare.mul(positionAssetRoutes[i].shares),
            [testTokenX.address, testTokenA.address],
            ancillaryDataMap[positionAssetRoutes[i].paths[0].dexName],
          );

          amountAreturned = amountAreturned.add(amountOutFromDex);
        }

        // limitPrice
        const amountXInWadDec = positionAmount.mul(multiplierX);
        const amountAInWadDec = BigNumber.from(amountAreturned).mul(multiplierA);
        limitPriceA = BigNumber.from(wadDiv(amountAInWadDec.toString(), amountXInWadDec.toString()).toString());
        limitPriceA = limitPriceA.div(multiplierA);

        // liquidationPrice and takeProfitPrice
        const liquidationPrice = await primexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
          positionManager.address,
          "bucket1",
          borrowedAmountA,
          testTokenX.address,
          positionAmount,
        );

        takeProfitPrice = liquidationPrice.mul(10).mul(multiplierA).toString();
      });

      it("Should open position by order on multiple dexes - deposit in a third asset", async function () {
        const deadline = new Date().getTime() + 600;
        const feeAmountCalculateWithETHRate = wadMul(
          wadMul(depositAmountB.toString(), leverage.toString()).toString(),
          protocolRate.toString(),
        ).toString();
        const feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierB).toString(),
          PriceInETH.toString(),
        ).toString();
        // create limit order
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenX.address,
            deadline: deadline,
            takeDepositFromWallet: true,
            payFeeFromWallet: true,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPriceA))],
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        // find perform data
        const liquidationSource = 2; // LiquidationSource for order
        const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
        const upkeep = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, openByOrderOutputSize);
        expect(upkeep.newCursor).to.equal(0);
        expect(upkeep.upkeepNeeded).to.equal(true);
        const performData = upkeep.performData;

        // decode performData
        const decodedData = defaultAbiCoder.decode(ORDER_INFO_DECODE, performData);

        const liquidationSourceDecoded = decodedData[0];
        const countDecoded = decodedData[1];
        const toOpenByOrder = decodedData[2];

        expect(liquidationSourceDecoded).to.equal(liquidationSource);
        expect(countDecoded).to.equal(1);

        // check firstAssetRoutes amount
        const firstAssetRoutesDecoded = toOpenByOrder[0][3];
        expect(firstAssetRoutesDecoded.length).to.equal(firstAssetRoutes.length);
        expect(firstAssetRoutesDecoded.length).to.be.gt(1);

        // check depositInThirdAssetRoutes amount
        const depositInThirdAssetRoutesDecoded = toOpenByOrder[0][4];
        expect(depositInThirdAssetRoutesDecoded.length).to.equal(depositInThirdAssetRoutes.length);
        expect(depositInThirdAssetRoutesDecoded.length).to.be.gt(1);

        // open position by order
        await primexUpkeep.performUpkeep(performData, deployer.address);

        // check upkeep
        const upkeep2 = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, openByOrderOutputSize);
        expect(upkeep2.upkeepNeeded).to.equal(false);
      });

      it("Should close position by condition on multiple dexes - deposit in a third asset", async function () {
        const deadline = new Date().getTime() + 600;
        const leverage = wadDiv(borrowedAmountA.toString(), depositAmountA.toString()).plus(WAD).toString();
        const feeAmountCalculateWithETHRate = wadMul(
          wadMul(depositAmountB.toString(), leverage.toString()).toString(),
          protocolRate.toString(),
        ).toString();

        const feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierB).toString(),
          PriceInETH.toString(),
        ).toString();

        // create a position
        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmountA,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenX.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: true,
            payFeeFromWallet: true,
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
          },
          { value: feeAmountInEth },
        );

        const currentPrice = await priceFeedAXdepositInThird.latestAnswer();
        await priceFeedAXdepositInThird.setAnswer(currentPrice.div(5));

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

        // find perform data
        const liquidationSource = 1; // LiquidationSource for position
        const checkData = defaultAbiCoder.encode(["uint256"], [liquidationSource]);
        const upkeep = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep.newCursor).to.equal(0);
        expect(upkeep.upkeepNeeded).to.equal(true);
        const performData = upkeep.performData;

        // decode performData
        const decodedData = defaultAbiCoder.decode(POSITION_INFO_DECODE, performData);

        // check positionId and positionAssetRoutes
        const toLiquidate = decodedData[2];
        const id = toLiquidate[0][0];
        const position = await positionManager.getPosition(id);
        expect(id).to.equal(position.id);

        const positionAssetRoutesDecoded = toLiquidate[0][3];
        expect(positionAssetRoutesDecoded.length).to.be.gt(1);
        expect(positionAssetRoutesDecoded.length).to.equal(positionAssetRoutes.length);

        // liquidate position
        await primexUpkeep.performUpkeep(performData, deployer.address);

        // checkUpkeep
        const upkeep2 = await primexUpkeep.callStatic.checkUpkeep(checkData, dexesWithAncillaryData, 0, 100, liquidationsOutputSize);
        expect(upkeep2.newCursor).to.equal(0);
        expect(upkeep2.upkeepNeeded).to.equal(false);
      });
    });
  });
});
