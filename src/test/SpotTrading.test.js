// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits, defaultAbiCoder },
    constants: { NegativeOne, AddressZero, MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  WAD,
  CloseReason,
  FeeRateType,
  TradingOrderType,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  MAX_TOKEN_DECIMALITY,
  USD_DECIMALS,
  USD_MULTIPLIER,
} = require("./utils/constants");
const { wadDiv, wadMul } = require("./utils/math");
const { calculateFeeInPaymentAsset, calculateMinPositionSize, calculateFeeAmountInPmx } = require("./utils/protocolUtils");
const {
  getAmountsOut,
  addLiquidity,
  getPair,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  getSingleMegaRoute,
  getGas,
} = require("./utils/dexOperations");
const { eventValidation, parseArguments } = require("./utils/eventValidation");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("./utils/conditionParams");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
  setBadOraclePrice,
} = require("./utils/oracleUtils");

process.env.TEST = true;

describe("SpotTrading", function () {
  let dex,
    dex2,
    positionManager,
    traderBalanceVault,
    testTokenC,
    testTokenB,
    testTokenD,
    decimalsC,
    decimalsD,
    multiplierC,
    multiplierD,
    limitOrderManager,
    bestDexLens,
    primexLens,
    pmAddress,
    PMXToken,
    PrimexDNS,
    SwapManager,
    Treasury,
    ancillaryDexData,
    ancillaryDexData2,
    firstAssetMegaRoutes,
    dex2Route,
    megaRoutesForClose;
  let pair;
  let priceOracle;
  let trader, liquidator;
  let snapshotIdBase;
  let depositAmount, ttaPriceInETH;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    ({ trader, liquidator } = await getNamedSigners());
    traderBalanceVault = await getContract("TraderBalanceVault");
    Treasury = await getContract("Treasury");

    await run("deploy:ERC20Mock", {
      name: "TestTokenC",
      symbol: "TTC",
      decimals: "18",
    });
    await run("deploy:ERC20Mock", {
      name: "TestTokenD",
      symbol: "TTD",
      decimals: "18",
    });
    await run("deploy:ERC20Mock", {
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: "18",
    });
    testTokenC = await getContract("TestTokenC");
    testTokenD = await getContract("TestTokenD");
    testTokenB = await getContract("TestTokenB");

    decimalsC = await testTokenC.decimals();
    decimalsD = await testTokenD.decimals();

    multiplierC = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsC));
    multiplierD = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsD));

    await testTokenC.mint(trader.address, parseEther("100"));

    PMXToken = await getContract("EPMXToken");

    bestDexLens = await getContract("BestDexLens");
    primexLens = await getContract("PrimexLens");
    positionManager = await getContract("PositionManager");
    pmAddress = positionManager.address;
    limitOrderManager = await getContract("LimitOrderManager");
    PrimexDNS = await getContract("PrimexDNS");
    SwapManager = await getContract("SwapManager");
    ErrorsLibrary = await getContract("Errors");

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

    firstAssetMegaRoutes = await getSingleMegaRoute([testTokenC.address, testTokenD.address], dex);

    dex2Route = await getSingleMegaRoute([testTokenD.address, testTokenC.address], dex2);
    megaRoutesForClose = await getSingleMegaRoute([testTokenD.address, testTokenC.address], dex);

    const data = await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenC, tokenB: testTokenD });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenC, tokenB: testTokenD });
    const pairAddress = await getPair(dex, testTokenC.address, testTokenD.address, data);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);

    priceOracle = await getContract("PriceOracle");
    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenC, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenD, parseUnits("1", USD_DECIMALS));

    depositAmount = parseEther("15");

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenC.address, testTokenD.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);
    //
    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("openPosition", function () {
    let snapshotId, openPositionParams, borrowedAmount, amountOutMin, takeDepositFromWallet, amountDOut, marginParams;
    before(async function () {
      borrowedAmount = BigNumber.from(0);
      amountOutMin = BigNumber.from(0);
      takeDepositFromWallet = true;

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);

      amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await setOraclePrice(testTokenC, testTokenD, limitPrice);

      marginParams = {
        bucket: "",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      };
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
      const deadline = new Date().getTime() + 600;
      openPositionParams = {
        marginParams: marginParams,
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      };
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

    it("Should revert openPosition when firstAssetMegaRoutes is empty list and it's spot", async function () {
      await expect(
        positionManager.connect(trader).openPosition({ ...openPositionParams, firstAssetMegaRoutes: [] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });

    it("Should revert openPosition when depositInThirdAssetMegaRoutes is not empty list and it's spot", async function () {
      await expect(
        positionManager.connect(trader).openPosition({
          ...openPositionParams,
          marginParams: { ...openPositionParams.marginParams, depositInThirdAssetMegaRoutes: firstAssetMegaRoutes },
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0");
    });

    it("Should revert openPosition when depositAsset is equal positionAsset", async function () {
      await expect(
        positionManager.connect(trader).openPosition({ ...openPositionParams, positionAsset: testTokenC.address }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_BE_DIFFERENT_ASSETS_IN_SPOT");
    });

    it("Should create 'Position' and swap trader deposit", async function () {
      await expect(() => positionManager.connect(trader).openPosition({ ...openPositionParams })).to.changeTokenBalances(
        testTokenD,
        [pair, positionManager],
        [amountDOut.mul(NegativeOne), amountDOut],
      );
    });
    it("Should create 'Position' and transfer depositAmount from trader", async function () {
      await expect(() => positionManager.connect(trader).openPosition({ ...openPositionParams })).to.changeTokenBalances(
        testTokenC,
        [trader, pair],
        [depositAmount.mul(NegativeOne), depositAmount],
      );
    });
    it("Should create position and increase traders count, and add traderPositions", async function () {
      await positionManager.connect(trader).openPosition({ ...openPositionParams });
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      const timestamp = (await provider.getBlock("latest")).timestamp;

      const position = await positionManager.getPosition(0);
      const extraParams = defaultAbiCoder.encode(["address"], [testTokenC.address]);
      const expectedPosition = {
        id: 0,
        scaledDebtAmount: 0,
        bucket: AddressZero,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        positionAmount: amountDOut,
        trader: trader.address,
        openBorrowIndex: 0,
        createdAt: timestamp,
        updatedConditionsAt: timestamp,
        extraParams: extraParams,
      };
      parseArguments(position, expectedPosition);
    });

    it("Should open position and throw event", async function () {
      const positionId = 0;
      const amount0Out = await getAmountsOut(dex, borrowedAmount.add(depositAmount), [testTokenC.address, testTokenD.address]);
      const entryPrice = wadDiv(borrowedAmount.add(depositAmount).toString(), amount0Out.toString()).toString();
      const leverage = wadDiv(borrowedAmount.add(depositAmount).toString(), depositAmount.toString()).toString();

      const txOpenPosition = await positionManager.connect(trader).openPosition({ ...openPositionParams });

      const position = await positionManager.getPosition(0);

      const expectedArguments = {
        positionId: positionId,
        trader: trader.address,
        openedBy: trader.address,
        position: position,
        entryPrice: entryPrice,
        leverage: leverage,
        closeConditions: [],
      };

      eventValidation("OpenPosition", await txOpenPosition.wait(), expectedArguments);
    });

    it("Should open position with stopLoss price < currentPrice", async function () {
      const stopLossPrice = wadDiv(depositAmount.toString(), amountDOut.toString()).toString();

      await expect(
        positionManager.connect(trader).openPosition({
          ...openPositionParams,
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, BigNumber.from(stopLossPrice).sub(3))),
          ],
        }),
      ).to.emit(positionManager, "OpenPosition");
    });

    it("Should transfer tokens from traderBalanceVault when openPosition with takeDepositFromWallet is false", async function () {
      await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);

      const { availableBalance: traderAvailableBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenC.address);

      const tx = positionManager.connect(trader).openPosition({ ...openPositionParams, takeDepositFromWallet: false });

      await expect(() => tx).to.changeTokenBalance(testTokenC, traderBalanceVault, depositAmount.mul(NegativeOne));
      const { availableBalance: traderAvailableBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(traderAvailableBalanceBefore.sub(traderAvailableBalanceAfter)).to.equal(depositAmount);
    });
  });

  describe("openPosition with minPositionSize", function () {
    let snapshotId, borrowedAmount, takeDepositFromWallet, deadline, marginParams;
    before(async function () {
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = true;
      borrowedAmount = 0;

      marginParams = {
        bucket: "",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      };
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

    it("Should revert when depositAmount < minPositionSize", async function () {
      const depositAmount = parseUnits("1", 14);

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await setOraclePrice(testTokenC, testTokenD, limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);

      await expect(
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: 0,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: [],
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
    });

    it("Should open position when position size >= minPositionSize", async function () {
      const depositAmount = parseEther("4");

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await setOraclePrice(testTokenC, testTokenD, limitPrice);
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);

      await expect(
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: 0,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: [],
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        }),
      ).to.emit(positionManager, "OpenPosition");
    });
  });

  describe("openPosition with maxPositionSize", function () {
    let snapshotId, borrowedAmount, takeDepositFromWallet, deadline, marginParams;
    before(async function () {
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = true;
      borrowedAmount = 0;

      marginParams = {
        bucket: "",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      };
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

    it("Should open position when position size > maxPositionSize", async function () {
      const depositAmount = parseEther("3");

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await setOraclePrice(testTokenC, testTokenD, limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);
      const { payload } = await encodeFunctionData(
        "setMaxPositionSize",
        [testTokenC.address, testTokenD.address, 0, amountDOut.sub(1)],
        "PositionManagerExtension",
      );
      await positionManager.setProtocolParamsByAdmin(payload);
      await expect(
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: 0,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: [],
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        }),
      ).to.emit(positionManager, "OpenPosition");
    });

    it("Should open position when position size <= maxPositionSize", async function () {
      const depositAmount = parseEther("4");

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await setOraclePrice(testTokenC, testTokenD, limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);
      const { payload } = await encodeFunctionData(
        "setMaxPositionSize",
        [testTokenC.address, testTokenD.address, 0, amountDOut],
        "PositionManagerExtension",
      );
      await positionManager.setProtocolParamsByAdmin(payload);

      await expect(
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: 0,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: [],
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        }),
      ).to.emit(positionManager, "OpenPosition");
    });
  });

  describe("closePosition", function () {
    let snapshotId;
    before(async function () {
      const borrowedAmount = 0;
      const amountOutMin = 0;
      const takeDepositFromWallet = true;

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await setOraclePrice(testTokenC, testTokenD, limitPrice);
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const amountCOutInWadDecimals = amountCOut.mul(multiplierC);
      const positionAmountInWadDecimals = positionAmount.mul(multiplierD);

      let price = wadDiv(positionAmountInWadDecimals.toString(), amountCOutInWadDecimals.toString()).toString();
      price = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenC, testTokenD, price);
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

    it("Should revert if SHARESONDEX_LENGTH_IS_0", async function () {
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            [],
            0,
            getEncodedChainlinkRouteViaUsd(testTokenC),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });

    it("Should close position and transfer testTokenD from 'PositionManager' to 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      await expect(() =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenC),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenD, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmount]);
    });

    it("Should close position and transfer testTokenC from 'Pair' to 'traderBalanceVault'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountCOut,
        FeeRateType.SpotPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );
      if (dex === "quickswapv3") {
        const balancePairBefore = await testTokenC.balanceOf(pair.address);
        const balanceTraderBalanceVaultBefore = await testTokenC.balanceOf(traderBalanceVault.address);
        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenC),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            [],
            [],
          );
        const balancePairAfter = await testTokenC.balanceOf(pair.address);
        const balanceTraderBalanceVaultAfter = await testTokenC.balanceOf(traderBalanceVault.address);
        const delta = wadMul(amountCOut.toString(), parseEther("0.01").toString()).toString();
        expect(balancePairAfter).to.be.closeTo(balancePairBefore.sub(amountCOut), delta);
        expect(balanceTraderBalanceVaultAfter).to.be.closeTo(balanceTraderBalanceVaultBefore.add(amountCOut).add(feeInPaymentAsset), delta);
      } else {
        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              megaRoutesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenC),
              getEncodedChainlinkRouteViaUsd(testTokenD),
              getEncodedChainlinkRouteViaUsd(testTokenD),
              [],
              [],
            ),
        ).to.changeTokenBalances(testTokenC, [pair, traderBalanceVault], [amountCOut.mul(NegativeOne), amountCOut.sub(feeInPaymentAsset)]);
      }
    });

    it("Should close position and delete trader position from traderPositions list", async function () {
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenC),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          [],
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should close position and update available balance of trader's tokens in trader balance Vault", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountCOut,
        FeeRateType.SpotPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );
      const { availableBalance: availableABefore } = await traderBalanceVault.balances(trader.address, testTokenC.address);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenC),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          [],
          [],
        );

      const { availableBalance: availableAAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);

      expect(availableABefore).to.equal(0);

      if (dex === "quickswapv3") {
        const delta = wadMul(amountCOut.toString(), parseEther("0.01").toString()).toString();
        expect(availableAAfter).to.be.closeTo(amountCOut.sub(feeInPaymentAsset), delta);
      } else {
        expect(availableAAfter).to.equal(amountCOut.sub(feeInPaymentAsset));
      }
    });

    it("Should close position and throw event", async function () {
      await network.provider.send("evm_mine");

      const { positionAmount, depositAmountInSoldAsset } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountCOut,
        FeeRateType.SpotPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );
      const profit = amountCOut.sub(depositAmountInSoldAsset).sub(feeInPaymentAsset);

      const tx = await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenC),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          [],
          [],
        );
      const expectedClosePosition = {
        positionI: 0,
        trader: trader.address,
        closedBy: trader.address,
        bucketAddress: AddressZero,
        soldAsset: testTokenC.address,
        positionAsset: testTokenD.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: 0,
        amountOut: amountCOut.sub(feeInPaymentAsset),
        reason: CloseReason.CLOSE_BY_TRADER,
      };

      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });

    it("Should NOT revert close position when prices on dex and oracle are different, but the position is spot", async function () {
      await setBadOraclePrice(testTokenC, testTokenD);
      expect(
        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenC),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            [],
            [],
          ),
      );
    });

    it("Should NOT revert partially close position when prices on dex and oracle are different", async function () {
      await setBadOraclePrice(testTokenC, testTokenD);
      const amount = parseEther("0.1");
      expect(
        await positionManager.connect(trader).partiallyClosePosition(
          0,
          amount,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenC),
          getEncodedChainlinkRouteViaUsd(testTokenD),
          getEncodedChainlinkRouteViaUsd(testTokenC),
          getEncodedChainlinkRouteViaUsd(testTokenC),

          [],
          [],
        ),
      );
    });

    it("Should partially close spot position", async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();
      const amount = parseEther("0.1");
      const amountOutMin = 0;
      const amountInBorrowed = await getAmountsOut(dex, amount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountInBorrowed,
        FeeRateType.SpotPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );
      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      const positionBefore = await positionManager.getPosition(0);

      await expect(() =>
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            0,
            amount,
            trader.address,
            megaRoutesForClose,
            amountOutMin,
            getEncodedChainlinkRouteViaUsd(testTokenC),
            getEncodedChainlinkRouteViaUsd(testTokenD),
            getEncodedChainlinkRouteViaUsd(testTokenC),
            getEncodedChainlinkRouteViaUsd(testTokenC),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenC, traderBalanceVault, amountInBorrowed.sub(feeInPaymentAsset));
      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(availableAfter).to.equal(availableBefore.add(amountInBorrowed).sub(feeInPaymentAsset));
      const position = await positionManager.getPosition(0);
      expect(position.positionAmount).to.be.equal(positionBefore.positionAmount.sub(amount));
      expect(position.scaledDebtAmount).to.be.equal(0);
    });
  });

  describe("closePosition by SL/TP", function () {
    let borrowedAmount,
      amountOutMin,
      deadline,
      takeDepositFromWallet,
      snapshotId,
      stopLossPrice,
      takeProfitPrice,
      conditionIndex,
      closePositionByConditionParams;
    before(async function () {
      conditionIndex = 0;
      borrowedAmount = 0;
      amountOutMin = 0;
      takeDepositFromWallet = true;

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(depositAmount));

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenC, testTokenD, price0);
      stopLossPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString()).sub("10");
      takeProfitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString()).add("10");
      deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await setOraclePrice(testTokenC, testTokenD, BigNumber.from(price0).mul(2));
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
      const ethAddress = await priceOracle.eth();
      closePositionByConditionParams = {
        id: 0,
        keeper: liquidator.address,
        megaRoutes: megaRoutesForClose,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: "0x",
        closeReason: CloseReason.LIMIT_CONDITION,
        positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
        pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      };
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

    it("Should close position by stop loss and transfer testTokenD from 'PositionManager' to 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      await expect(() =>
        positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
      ).to.changeTokenBalances(testTokenD, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmount]);
    });

    it("Should close position by stop loss and transfer testTokenC from 'Pair' to 'traderBalanceVault'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amount0Out,
        FeeRateType.SpotPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );
      await expect(() =>
        positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
      ).to.changeTokenBalances(testTokenC, [pair, traderBalanceVault], [amount0Out.mul(NegativeOne), amount0Out.sub(feeInPaymentAsset)]);
    });

    it("Should close position by stop loss and correctly updated balances in the vault", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountCOut,
        FeeRateType.SpotPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );

      expect(await primexLens.callStatic.isStopLossReached(pmAddress, 0, getEncodedChainlinkRouteViaUsd(testTokenC), [], [])).to.equal(
        true,
      );

      await expect(() =>
        positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
      ).to.changeTokenBalance(testTokenC, traderBalanceVault, amountCOut.sub(feeInPaymentAsset));

      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(traderBalance).to.be.equal(amountCOut.sub(feeInPaymentAsset));
    });

    it("Should close position by take profit and correctly updated balances in the vault", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseEther("4").toString(),
        path: [testTokenC.address, testTokenD.address],
      });
      const { positionAmount } = await positionManager.getPosition(0);

      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountCOut,
        FeeRateType.SpotPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );

      await expect(() =>
        positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
      ).to.changeTokenBalance(testTokenC, traderBalanceVault, amountCOut.sub(feeInPaymentAsset));

      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(traderBalance).to.be.equal(amountCOut.sub(feeInPaymentAsset));
    });

    it("Should close position by stop loss and throw event", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenC.address,
        amountCOut,
        FeeRateType.SpotPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenC),
      );

      const tx = await positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams });
      const thReceipt = await tx.wait();

      const profit = amountCOut.sub(depositAmount).sub(feeInPaymentAsset);

      const expectedEventArguments = {
        positionId: 0,
        trader: trader.address,
        closedBy: liquidator.address,
        bucketAddress: AddressZero,
        soldAsset: testTokenC.address,
        positionAsset: testTokenD.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: 0,
        amountOut: amountCOut.sub(feeInPaymentAsset),
        reason: CloseReason.LIMIT_CONDITION,
      };
      eventValidation("ClosePosition", thReceipt, expectedEventArguments, await getContractAt("PositionLibrary", positionManager.address));
    });
  });

  describe("getBestDexByPosition", function () {
    let snapshotId, dexesWithAncillaryData;
    before(async function () {
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);
      const borrowedAmount = 0;
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenC, testTokenD, price0);

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

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
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
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut1 = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const amountCOut2 = await getAmountsOut(dex2, positionAmount, [testTokenD.address, testTokenC.address]);
      expect(amountCOut1).to.be.gt(amountCOut2);

      const bestShares = await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, 0, 1, dexesWithAncillaryData);
      parseArguments(bestShares, {
        returnAmount: amountCOut1,
        estimateGasAmount: await getGas(dex),
        megaRoutes: megaRoutesForClose,
      });
    });
    it("When second dex is best to swap borrowedAmount return correct dexes name", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseEther("50").toString(),
        path: [testTokenC.address, testTokenD.address],
      });

      const amountCOut1 = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);

      const amountCOut2 = await getAmountsOut(dex2, positionAmount, [testTokenD.address, testTokenC.address]);

      expect(amountCOut2).to.be.gt(amountCOut1);

      const bestShares = await bestDexLens.callStatic.getBestDexByPosition(positionManager.address, 0, 1, dexesWithAncillaryData);

      const bestRoute = {
        returnAmount: amountCOut2,
        estimateGasAmount: await getGas(dex2),
        megaRoutes: dex2Route,
      };
      parseArguments(bestShares, bestRoute);
    });
  });

  describe("getBestDexForOpenablePosition", function () {
    let snapshotId, dexesWithAncillaryData, getBestDexForOpenablePositionData, expectedBestShares;
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
      getBestDexForOpenablePositionData = {
        positionManager: positionManager.address,
        borrowedAsset: testTokenC.address,
        borrowedAmount: 0,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        shares: { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
        dexes: dexesWithAncillaryData,
      };
      expectedBestShares = {
        firstAssetReturnParams: {},
        depositInThirdAssetReturnParams: { returnAmount: 0, estimateGasAmount: 0, megaRoutes: [] },
        depositToBorrowedReturnParams: { returnAmount: 0, estimateGasAmount: 0, megaRoutes: [] },
      };

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseEther("1").toString(),
        path: [testTokenC.address, testTokenD.address],
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
    it("When first dex is best to open spot position return correct dex name", async function () {
      const amount0Out1 = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const amount0Out2 = await getAmountsOut(dex2, depositAmount, [testTokenC.address, testTokenD.address]);
      expect(amount0Out1).to.be.gt(amount0Out2);
      const bestShares = await bestDexLens.callStatic.getBestDexForOpenablePosition(getBestDexForOpenablePositionData);

      expectedBestShares.firstAssetReturnParams = {
        returnAmount: amount0Out1,
        estimateGasAmount: await getGas(dex),
        megaRoutes: firstAssetMegaRoutes,
      };

      parseArguments(bestShares, expectedBestShares);
    });
    it("When second dex is best to open spot position return correct dexes name", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseEther("5").toString(),
        path: [testTokenC.address, testTokenD.address],
      });

      const amount0Out1 = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const amount0Out2 = await getAmountsOut(dex2, depositAmount, [testTokenC.address, testTokenD.address]);
      expect(amount0Out2).to.be.gt(amount0Out1);

      const bestShares = await bestDexLens.callStatic.getBestDexForOpenablePosition(getBestDexForOpenablePositionData);
      expectedBestShares.firstAssetReturnParams = {
        returnAmount: amount0Out2,
        estimateGasAmount: await getGas(dex2),
        megaRoutes: await getSingleMegaRoute([testTokenC.address, testTokenD.address], dex2),
      };

      parseArguments(bestShares, expectedBestShares);
    });
  });

  describe("canBeClosed", function () {
    let borrowedAmount, amountDOut, depositAmount, amountOutMin, deadline, takeDepositFromWallet, snapshotId, exchangeRate, price0;

    before(async function () {
      depositAmount = parseEther("15");
      borrowedAmount = 0;
      amountOutMin = 0;
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = true;
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);

      amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
      price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenC, testTokenD, price0);
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

    it("isStopLossReached should return 'false' when stopLossPrice < oracle price", async function () {
      const stopLossPrice = wadDiv(WAD, exchangeRate.add("1").toString()).toString();

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });
      expect(await primexLens.callStatic.isStopLossReached(pmAddress, 0, getEncodedChainlinkRouteViaUsd(testTokenC), [], [])).to.be.equal(
        false,
      );
    });

    it("isStopLossReached should return 'true' when oracle price <= stopLossPrice", async function () {
      const stopLossPrice = wadDiv(WAD, exchangeRate.add("1").toString()).toString();

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });

      await setOraclePrice(testTokenC, testTokenD, price0.add(2));
      expect(await primexLens.callStatic.isStopLossReached(pmAddress, 0, getEncodedChainlinkRouteViaUsd(testTokenC), [], [])).to.be.equal(
        true,
      );
    });
  });

  describe("Limit Order", function () {
    let snapshotId, leverage, takeDepositFromWallet, snapshotIdBase2;
    before(async function () {
      leverage = parseEther("1");
      takeDepositFromWallet = true;

      await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);

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
      it("Should revert when depositAsset is equal positionAsset", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenC.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            leverage: leverage,
            shouldOpenPosition: true,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_BE_DIFFERENT_ASSETS_IN_SPOT");
      });

      it("Should revert when leverage is not 1", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            leverage: parseEther("2"),
            shouldOpenPosition: true,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_SHOULD_BE_1");
      });

      it("Should create 'LimitOrder' and transfer testTokenC from trader to 'TraderBalanceVault'", async function () {
        const deadline = new Date().getTime() + 600;
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(0);
        expect(lockedBefore).to.equal(0);

        await expect(() =>
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            leverage: leverage,
            shouldOpenPosition: true,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.changeTokenBalances(testTokenC, [trader, traderBalanceVault], [depositAmount.mul(NegativeOne), depositAmount]);

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(depositAmount);

        const { limitOrdersWithConditions } = await primexLens.getLimitOrdersWithConditions(limitOrderManager.address, 0, 10);

        expect(await limitOrderManager.getOrdersLength()).to.equal(1);
        expect(limitOrdersWithConditions.length).to.be.equal(1);
        expect(await limitOrderManager.ordersId()).to.be.equal(1);
        expect(await limitOrderManager.orderIndexes(limitOrdersWithConditions[0].limitOrderData.id)).to.be.equal(0);
      });

      it("Should create 'LimitOrder' with takeDepositFromWallet=false and lock testTokenC in 'TraderBalanceVault'", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(depositAmount);
        expect(lockedBefore).to.equal(0);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          leverage: leverage,
          shouldOpenPosition: true,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(depositAmount);

        const { limitOrdersWithConditions } = await primexLens.getLimitOrdersWithConditions(limitOrderManager.address, 0, 10);

        expect(await limitOrderManager.getOrdersLength()).to.equal(1);
        expect(limitOrdersWithConditions.length).to.be.equal(1);
        expect(await limitOrderManager.ordersId()).to.be.equal(1);
        expect(await limitOrderManager.orderIndexes(limitOrdersWithConditions[0].limitOrderData.id)).to.be.equal(0);
      });

      it("Should create 'LimitOrder' with the correct variables", async function () {
        const deadline = new Date().getTime() + 600;

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
          ],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderCreatedAt = (await provider.getBlock("latest")).timestamp;
        const order = await limitOrderManager.getOrder(1);

        expect(order.createdAt).to.gt(0);

        await network.provider.send("evm_mine");

        const timestampAfterOrderCreated = (await provider.getBlock("latest")).timestamp;
        expect(order.createdAt).to.lt(timestampAfterOrderCreated);

        const settedOpenConditions = [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))];
        const settedCloseConditions = [
          getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
        ];
        const expectedOrder = {
          bucket: AddressZero,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: testTokenD.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: 1,
          leverage: parseEther("1"),
          shouldOpenPosition: true,
          createdAt: orderCreatedAt,
          updatedConditionsAt: orderCreatedAt,
          extraParams: "0x",
        };

        parseArguments(expectedOrder, order);
        const openCondition = await limitOrderManager.getOpenConditions(1);
        const closeCondition = await limitOrderManager.getCloseConditions(1);

        parseArguments(settedOpenConditions, openCondition);
        parseArguments(settedCloseConditions, closeCondition);
      });

      it("Should create 'LimitOrder' with isProtocolFeeInPmx=true with takeDepositFromWallet=true", async function () {
        const deadline = new Date().getTime() + 600;
        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
          ],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderCreatedAt = (await provider.getBlock("latest")).timestamp;
        const order = await limitOrderManager.getOrder(1);

        expect(order.createdAt).to.gt(0);

        await network.provider.send("evm_mine");

        const timestampAfterOrderCreated = (await provider.getBlock("latest")).timestamp;
        expect(order.createdAt).to.lt(timestampAfterOrderCreated);

        const settedOpenConditions = [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))];
        const settedCloseConditions = [
          getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
        ];
        const expectedOrder = {
          bucket: AddressZero,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: 1,
          leverage: parseEther("1"),
          shouldOpenPosition: true,
          createdAt: orderCreatedAt,
          updatedConditionsAt: orderCreatedAt,
          extraParams: "0x",
        };

        parseArguments(expectedOrder, order);
        const openCondition = await limitOrderManager.getOpenConditions(1);
        const closeCondition = await limitOrderManager.getCloseConditions(1);

        parseArguments(settedOpenConditions, openCondition);
        parseArguments(settedCloseConditions, closeCondition);
        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(depositAmount);
      });

      it("Should create 'LimitOrder' with isProtocolFeeInPmx=true with takeDepositFromWallet=false", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;

        await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);

        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(depositAmount);
        expect(lockedBefore).to.equal(0);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
          ],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderCreatedAt = (await provider.getBlock("latest")).timestamp;
        const order = await limitOrderManager.getOrder(1);

        const expectedOrder = {
          bucket: AddressZero,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: 1,
          leverage: parseEther("1"),
          shouldOpenPosition: true,
          createdAt: orderCreatedAt,
          updatedConditionsAt: orderCreatedAt,
          extraParams: "0x",
        };

        parseArguments(expectedOrder, order);

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(depositAmount);
      });
      it("Should open spot limit order and throw event", async function () {
        const deadline = new Date().getTime() + 600;
        const orderId = 1;

        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          isProtocolFeeInPmx: true,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const orderObject = {
          bucket: (await limitOrderManager.getOrder(orderId)).bucket,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
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

        const expectedArguments = [orderId, trader.address, orderObject, [[LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1)]], []];

        eventValidation("CreateLimitOrder", await txCreateLimitOrder.wait(), expectedArguments);
      });

      it("Should open swap limit order and throw event", async function () {
        const deadline = new Date().getTime() + 600;
        const orderId = 1;

        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: false,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          isProtocolFeeInPmx: true,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });

        const orderObject = {
          bucket: (await limitOrderManager.getOrder(orderId)).bucket,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: 0,
          trader: trader.address,
          deadline: deadline,
          id: orderId,
          leverage: leverage,
          shouldOpenPosition: false,
          createdAt: (await provider.getBlock("latest")).timestamp,
          updatedConditionsAt: (await provider.getBlock("latest")).timestamp,
          extraParams: "0x",
        };

        const expectedArguments = [orderId, trader.address, orderObject, [[LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1)]], []];

        eventValidation("CreateLimitOrder", await txCreateLimitOrder.wait(), expectedArguments);
      });

      it("Should createLimitOrder with stopLossPrice*positionAmount < depositAmount", async function () {
        const deadline = new Date().getTime() + 600;
        const limitPrice = parseEther("1");
        const stopLossPrice = limitPrice.sub(1);
        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.emit(limitOrderManager, "CreateLimitOrder");
      });
    });

    describe("CancelLimitOrder", function () {
      let orderId;
      // eslint-disable-next-line mocha/no-hooks-for-single-case
      before(async function () {
        const deadline = new Date().getTime() + 600;
        leverage = parseEther("1");
        takeDepositFromWallet = true;
        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const txReceipt = await txCreateLimitOrder.wait();
        orderId = txReceipt.events?.filter(x => {
          return x.event === "CreateLimitOrder";
        })[0].args.orderId;
      });
      // eslint-disable-next-line mocha/no-hooks-for-single-case
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
      it("Should cancel spot limit order and throw event", async function () {
        const CloseReason = 3; // cancelled
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        const txCancelLimitOrder = await limitOrderManager.connect(trader).cancelLimitOrder(orderId);
        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableAfter.sub(availableBefore)).to.equal(depositAmount);
        expect(lockedBefore.sub(lockedAfter)).to.equal(depositAmount);

        const expectedArguments = {
          orderId: orderId,
          trader: trader.address,
          closedBy: trader.address,
          reason: CloseReason,
          positionId: 0,
          bucket: "",
          borrowedAsset: AddressZero,
          positionAsset: testTokenD.address,
          leverage: leverage,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
        };

        eventValidation("CloseLimitOrder", await txCancelLimitOrder.wait(), expectedArguments);
      });
    });
    describe("CreateLimitOrder with minPositionSize", function () {
      let additionalParams;

      before(async function () {
        additionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, []);
      });

      it("Should revert when depositAmount < minPositionSize", async function () {
        const deadline = new Date().getTime() + 600;
        const depositAmount = parseUnits("1", 14);

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });

      it("Should create limit order when position size >= minPositionSize", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
            nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
            borrowedAmount: 0,
          }),
        ).to.emit(limitOrderManager, "CreateLimitOrder");
      });

      it("Should revert openPositionByOrder when position size < minPositionSize", async function () {
        const deadline = new Date().getTime() + 600;
        const minPositionSize = await calculateMinPositionSize(
          TradingOrderType.SpotMarketOrder,
          testTokenC.address,
          getEncodedChainlinkRouteViaUsd(testTokenC),
        );
        const depositAmount = minPositionSize.add(10);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          leverage: leverage,
          shouldOpenPosition: true,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderId = await limitOrderManager.ordersId();

        await setupUsdOraclesForTokens(testTokenC, await priceOracle.eth(), ttaPriceInETH.div(2));

        await expect(
          limitOrderManager.openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: additionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: [],
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
            borrowedAmount: 0,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
    });

    describe("openPositionByOrder - spot order", function () {
      let orderId,
        order,
        slPrice,
        tpPrice,
        closeConditions,
        availableBeforeAll,
        lockedBeforeAll,
        exchangeRate,
        limitPrice,
        amountDOut,
        borrowedAmount,
        defaultAdditionalParams,
        ethAddress,
        openPositionByOrderParams;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        borrowedAmount = BigNumber.from(0);
        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
        availableBeforeAll = availableBalance;
        lockedBeforeAll = lockedBalance;
        amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());
        const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenC, testTokenD, price0);

        const difference = parseEther("1");
        slPrice = limitPrice.sub(difference);
        tpPrice = limitPrice.add(difference);
        closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))];
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: closeConditions,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        orderId = await limitOrderManager.ordersId();
        order = await limitOrderManager.getOrder(1);

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, []);
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
      beforeEach(async function () {
        ethAddress = await priceOracle.eth();
        openPositionByOrderParams = {
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
          borrowedAmount: 0,
        };
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
      it("Should revert openPositionByOrder when borrowedAmount is not zero", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams, borrowedAmount: 1 }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_BORROWED_AMOUNT");
      });

      it("Should revert openPositionByOrder when firstAssetMegaRoutes is empty list", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams, firstAssetMegaRoutes: [] }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should revert openPositionByOrder when depositInThirdAssetMegaRoutes is not empty list", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            ...openPositionByOrderParams,
            depositInThirdAssetMegaRoutes: firstAssetMegaRoutes,
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0");
      });

      it("Should revert when the order price isn't reached", async function () {
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseEther("1").toString(),
          path: [testTokenC.address, testTokenD.address],
        });

        const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        const exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenC, testTokenD, price0);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_CAN_NOT_BE_FILLED");
      });

      it("Should create position by order and transfer testTokenC from 'Bucket' to 'Pair'", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams }),
        ).to.changeTokenBalances(testTokenC, [traderBalanceVault, pair], [depositAmount.mul(NegativeOne.toString()), depositAmount]);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order and transfer testTokenD to 'PositionManager'", async function () {
        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenD.address,
          amountDOut,
          FeeRateType.SpotLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenD),
        );
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams }),
        ).to.changeTokenBalance(testTokenD, positionManager, amountDOut.sub(feeInPositionAsset));

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order, increase traders count, add traderPositions and then deleted the order", async function () {
        await limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams });

        const positionCreatedAt = (await provider.getBlock("latest")).timestamp;
        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenD.address,
          amountDOut,
          FeeRateType.SpotLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenD),
        );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

        const position = await positionManager.getPosition(0);
        expect(order.createdAt).to.lt(position.createdAt);
        const extraParams = defaultAbiCoder.encode(["address"], [testTokenC.address]);

        const expectedPosition = {
          id: 0,
          scaledDebtAmount: 0,
          bucket: AddressZero,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          positionAmount: amountDOut.sub(feeInPositionAsset),
          trader: trader.address,
          openBorrowIndex: 0,
          createdAt: positionCreatedAt,
          updatedConditionsAt: positionCreatedAt,
          extraParams: extraParams,
        };
        parseArguments(expectedPosition, position);
        parseArguments(closeConditions, await positionManager.getCloseConditions(0));

        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should open position by order and throw event 'OpenPosition'", async function () {
        const positionId = 0;
        const amount0Out = await getAmountsOut(dex, borrowedAmount.add(depositAmount), [testTokenC.address, testTokenD.address]);
        const entryPrice = wadDiv(borrowedAmount.add(depositAmount).toString(), amount0Out.toString()).toString();
        const leverage = wadDiv(borrowedAmount.add(depositAmount).toString(), depositAmount.toString()).toString();

        const tx = await limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams });

        const position = await positionManager.getPosition(0);

        const expectedArguments = {
          positionId: positionId,
          trader: trader.address,
          openedBy: liquidator.address,
          position: position,
          entryPrice: entryPrice,
          leverage: leverage,
          closeConditions: closeConditions,
        };

        eventValidation("OpenPosition", await tx.wait(), expectedArguments, positionManager);
      });

      it("Should open position by order and throw event 'CloseLimitOrder'", async function () {
        const closeReasonFilledSpot = 1;
        const newPositionID = await positionManager.positionsId();
        const txCloseLimitOrder = await limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams });

        const expectedArguments = {
          orderId: orderId,
          trader: trader.address,
          closedBy: liquidator.address,
          reason: closeReasonFilledSpot,
          positionId: newPositionID,
          bucket: "",
          borrowedAsset: AddressZero,
          positionAsset: testTokenD.address,
          leverage: leverage,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
        };
        eventValidation("CloseLimitOrder", await txCloseLimitOrder.wait(), expectedArguments);
      });

      it("Should open position by order and lock trader deposit in traderBalanceVault", async function () {
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(availableBeforeAll);
        expect(lockedBefore).to.equal(lockedBeforeAll.add(depositAmount));

        await limitOrderManager.connect(liquidator).openPositionByOrder({ ...openPositionByOrderParams });
        const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);

        expect(availableAfter).to.equal(availableBefore);
      });

      it("Should open position by order when isProtocolFeeInPmx=true", async function () {
        // second order with isProtocolFeeInPmx=true
        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
        const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
        const feeInPaymentAsset = await calculateFeeInPaymentAsset(
          testTokenC.address,
          amountDOut,
          FeeRateType.SpotLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenC),
        );
        const feeInPositonAssetWithDiscount = wadMul(feeInPaymentAsset.toString(), pmxDiscountMultiplier.toString()).toString();
        const feeAmountInPmxForLimitOrders = await calculateFeeAmountInPmx(
          testTokenD.address,
          PMXToken.address,
          feeInPositonAssetWithDiscount,
          getEncodedChainlinkRouteViaUsd(PMXToken),
        );

        await PMXToken.transfer(trader.address, parseUnits("2", 18));
        await PMXToken.connect(trader).approve(traderBalanceVault.address, parseUnits("2", 18));
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseUnits("2", 18));

        const deadline = new Date().getTime() + 600;

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderId = await limitOrderManager.ordersId();

        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(availableBeforeAll);
        expect(lockedBefore).to.equal(lockedBeforeAll.add(depositAmount).add(depositAmount));
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: [],
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
            borrowedAmount: 0,
          }),
        ).to.changeTokenBalances(
          PMXToken,
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInPmxForLimitOrders).mul(NegativeOne), feeAmountInPmxForLimitOrders],
        );

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableAfter).to.equal(availableBefore);
        expect(lockedAfter).to.equal(lockedBefore.sub(depositAmount));
      });
    });

    describe("openPositionByOrder - swap order", function () {
      let orderId, exchangeRate, limitPrice, amountDOut, defaultAdditionalParams, ethAddress;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        ethAddress = await priceOracle.eth();
        amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenC, testTokenD, price0);

        limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: false,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        orderId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, []);
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

      it("Should revert when the order price isn't reached", async function () {
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseEther("1").toString(),
          path: [testTokenC.address, testTokenD.address],
        });
        const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        const exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenC, testTokenD, price0);

        await testTokenD.connect(trader).approve(SwapManager.address, depositAmount);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: [],
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
            borrowedAmount: 0,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_CAN_NOT_BE_FILLED");
      });

      it("Should not create position by order and transfer testTokenC from 'Bucket' to 'Pair'", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: [],
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
            pullOracleData: [],
            pullOracleTypes: [],
            borrowedAmount: 0,
          }),
        ).to.changeTokenBalances(testTokenC, [traderBalanceVault, pair], [depositAmount.mul(NegativeOne.toString()), depositAmount]);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });

      it("Should not create position by order and transfer testTokenD to traderBalanceVault, update trader balance in traderBalanceVault", async function () {
        const { availableBalance: availableBeforeC, lockedBalance: lockedBeforeC } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );

        const { availableBalance: availableBeforeD, lockedBalance: lockedBeforeD } = await traderBalanceVault.balances(
          trader.address,
          testTokenD.address,
        );
        expect(availableBeforeC).to.equal(0);
        expect(lockedBeforeC).to.equal(depositAmount);

        expect(availableBeforeD).to.equal(0);
        expect(lockedBeforeD).to.equal(0);

        const feeInPositionAsset = await calculateFeeInPaymentAsset(
          testTokenD.address,
          amountDOut,
          FeeRateType.SwapLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenD),
        );

        const tx = await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
          borrowedAmount: 0,
        });
        await expect(() => tx).to.changeTokenBalance(testTokenD, traderBalanceVault, amountDOut.sub(feeInPositionAsset));
        const { availableBalance: availableAfterC, lockedBalance: lockedAfterC } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        const { availableBalance: availableAfterD, lockedBalance: lockedAfterD } = await traderBalanceVault.balances(
          trader.address,
          testTokenD.address,
        );
        expect(availableAfterC).to.equal(0);
        expect(lockedAfterC).to.equal(0);
        expect(availableAfterD).to.equal(amountDOut.sub(feeInPositionAsset));
        expect(lockedAfterD).to.equal(0);
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });

      it("Should not create position by order and transfer testTokenD to traderBalanceVault, update trader balance in traderBalanceVault. protocolFeeInPmx=true", async function () {
        // second order with isProtocolFeeInPmx=true
        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
        const deadline = new Date().getTime() + 600;
        await PMXToken.transfer(trader.address, parseEther("1"));
        await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: false,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        });
        const orderId = await limitOrderManager.ordersId();

        const { availableBalance: availableBeforeC, lockedBalance: lockedBeforeC } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );

        const { availableBalance: availableBeforeD, lockedBalance: lockedBeforeD } = await traderBalanceVault.balances(
          trader.address,
          testTokenD.address,
        );
        expect(availableBeforeC).to.equal(0);
        expect(lockedBeforeC).to.equal(depositAmount.add(depositAmount));

        expect(availableBeforeD).to.equal(0);
        expect(lockedBeforeD).to.equal(0);
        const tx = limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
          borrowedAmount: 0,
        });
        await expect(() => tx).to.changeTokenBalance(testTokenD, traderBalanceVault, amountDOut);

        const { availableBalance: availableAfterC, lockedBalance: lockedAfterC } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );

        const { availableBalance: availableAfterD, lockedBalance: lockedAfterD } = await traderBalanceVault.balances(
          trader.address,
          testTokenD.address,
        );

        expect(availableAfterC).to.equal(0);
        expect(lockedAfterC).to.equal(depositAmount);

        expect(availableAfterD).to.equal(amountDOut);
        expect(lockedAfterD).to.equal(0);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });
      it("Should throw event 'CloseLimitOrder'", async function () {
        const closeReasonFilledSpot = 2;
        const newPositionID = await positionManager.positionsId();
        const txCloseLimitOrder = await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: [],
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: ethAddress }),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
          borrowedAmount: 0,
        });

        const expectedArguments = {
          orderId: orderId,
          trader: trader.address,
          closedBy: liquidator.address,
          reason: closeReasonFilledSpot,
          positionId: newPositionID,
          bucket: "",
          borrowedAsset: AddressZero,
          positionAsset: testTokenD.address,
          leverage: leverage,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
        };
        eventValidation("CloseLimitOrder", await txCloseLimitOrder.wait(), expectedArguments);
      });
    });

    describe("getBestDexByOrder", function () {
      let snapshotId, dexesWithAncillaryData;

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

        const deadline = new Date().getTime() + 600;
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          leverage: leverage,
          shouldOpenPosition: true,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
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
        await swapExactTokensForTokens({
          dex: dex2,
          amountIn: parseEther("1").toString(),
          path: [testTokenC.address, testTokenD.address],
        });
        const amount0Out1 = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        const amount0Out2 = await getAmountsOut(dex2, depositAmount, [testTokenC.address, testTokenD.address]);

        expect(amount0Out1).to.be.gt(amount0Out2);
        const bestShares = await bestDexLens.callStatic[
          "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[],bytes,bytes[][],uint256[]))"
        ]([
          positionManager.address,
          limitOrderManager.address,
          1,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
          getEncodedChainlinkRouteViaUsd(testTokenC),
          [],
          [],
        ]);
        parseArguments(bestShares.firstAssetReturnParams, {
          returnAmount: amount0Out1,
          estimateGasAmount: await getGas(dex),
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
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseEther("2").toString(),
          path: [testTokenC.address, testTokenD.address],
        });

        const amount0Out1 = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        const amount0Out2 = await getAmountsOut(dex2, depositAmount, [testTokenC.address, testTokenD.address]);
        expect(amount0Out2).to.be.gt(amount0Out1);

        const bestShares = await bestDexLens.callStatic[
          "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[],bytes,bytes[][],uint256[]))"
        ]([
          positionManager.address,
          limitOrderManager.address,
          1,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
          getEncodedChainlinkRouteViaUsd(testTokenC),
          [],
          [],
        ]);
        parseArguments(bestShares.firstAssetReturnParams, {
          returnAmount: amount0Out2,
          estimateGasAmount: await getGas(dex2),
          megaRoutes: await getSingleMegaRoute([testTokenC.address, testTokenD.address], dex2),
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
  });

  describe("updatePositionConditions", function () {
    let positionId, snapshotId;
    before(async function () {
      const borrowedAmount = 0;
      const amountOutMin = 0;
      const takeDepositFromWallet = true;
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(depositAmount));
      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      const price0 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenC, testTokenD, price0);

      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetMegaRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        closeConditions: [],
        firstAssetOracleData: [],
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });
      positionId = 0;
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

    it("Revert when increaseDeposit for a position if borrowed amount = 0", async function () {
      const depositIncrease = parseEther("1");
      await expect(
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenC.address, true, [], 0),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BORROWED_AMOUNT_IS_ZERO");
    });

    it("Revert when decreaseDeposit for spot position", async function () {
      const depositDecrease = parseEther("1");
      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(positionId, depositDecrease, getEncodedChainlinkRouteViaUsd(testTokenC), [], [], []),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "IS_SPOT_POSITION");
    });
  });

  describe("updateOrder", function () {
    let exchangeRate, leverage, limitPrice, amountDOut, stopLossPrice, takeProfitPrice;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      const takeDepositFromWallet = true;
      leverage = parseEther("1");
      const deadline = new Date().getTime() + 600;

      amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
      const price0 = BigNumber.from(exchangeRate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenC, testTokenD, price0);

      limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());

      stopLossPrice = limitPrice.sub("100");
      takeProfitPrice = limitPrice.add("100");
      await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "",
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });
    });

    it("Should revert when update leverage", async function () {
      const newLeverage = leverage.add(1);
      await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
      const deadline = new Date().getTime() + 600;

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "",
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        deadline: deadline,
        takeDepositFromWallet: true,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
        pullOracleTypes: [],
      });
      const orderId = await limitOrderManager.ordersId();

      await expect(
        limitOrderManager.connect(trader).updateOrder({
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: newLeverage,
          nativeDepositOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
          pullOracleData: [],
          pullOracleTypes: [],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CANNOT_CHANGE_SPOT_ORDER_TO_MARGIN");
    });
  });
});
