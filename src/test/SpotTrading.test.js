// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { NegativeOne, AddressZero, MaxUint256 },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  WAD,
  CloseReason,
  NATIVE_CURRENCY,
  OrderType,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  MAX_TOKEN_DECIMALITY,
} = require("./utils/constants");
const { wadDiv, wadMul } = require("./utils/math");
const {
  getAmountsOut,
  addLiquidity,
  getPair,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  getSingleRoute,
  getGas,
} = require("./utils/dexOperations");
const { eventValidation, parseArguments } = require("./utils/eventValidation");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getTakeProfitStopLossAdditionalParams,
  getCondition,
} = require("./utils/conditionParams");
const { setBadOraclePrice, fivePercent } = require("./utils/setBadOraclePrice");

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
    PrimexDNS,
    PMXToken,
    Treasury,
    ancillaryDexData,
    ancillaryDexData2,
    firstAssetRoutes,
    dex2Route,
    routesForClose;
  let pair;
  let priceFeed, priceOracle;
  let deployer, trader, liquidator;
  let snapshotIdBase;
  let feeAmountInPmx, feeAmountInEth, feeAmountInPmxForLimitOrders, feeAmountInEthForLimitOrders, depositAmount, PriceInETH, PriceInPMX;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, liquidator } = await getNamedSigners());
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

    firstAssetRoutes = await getSingleRoute([testTokenC.address, testTokenD.address], dex);
    dex2Route = await getSingleRoute([testTokenD.address, testTokenC.address], dex2);
    routesForClose = await getSingleRoute([testTokenD.address, testTokenC.address], dex);

    const data = await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenC, tokenB: testTokenD });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenC, tokenB: testTokenD });

    const pairAddress = await getPair(dex, testTokenC.address, testTokenD.address, data);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals("18");
    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenC.address, testTokenD.address, priceFeed.address);
    depositAmount = parseEther("15");
    //
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_PMX", deployer.address);
    const priceFeedTTCETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTC_ETH", deployer.address);

    const decimalsPMX = await PMXToken.decimals();
    await priceFeedTTAPMX.setDecimals(decimalsPMX);
    PriceInPMX = parseUnits("0.2", decimalsPMX); // 1 tta=0.2 pmx
    await priceFeedTTAPMX.setAnswer(PriceInPMX);
    PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTCETH.setDecimals("18");
    await priceFeedTTCETH.setAnswer(PriceInETH);

    feeAmountInPmx = calculateFee(depositAmount, await PrimexDNS.feeRates(OrderType.MARKET_ORDER, PMXToken.address), PriceInPMX);
    feeAmountInPmxForLimitOrders = calculateFee(
      depositAmount,
      await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, PMXToken.address),
      PriceInPMX,
    );

    feeAmountInEth = calculateFee(depositAmount, await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY), PriceInETH);
    feeAmountInEthForLimitOrders = calculateFee(
      depositAmount,
      await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, NATIVE_CURRENCY),
      PriceInETH,
    );

    await priceOracle.updatePriceFeed(testTokenC.address, PMXToken.address, priceFeedTTAPMX.address);
    await priceOracle.updatePriceFeed(testTokenC.address, await priceOracle.eth(), priceFeedTTCETH.address);
    await priceOracle.updatePriceFeed(testTokenD.address, await priceOracle.eth(), priceFeedTTCETH.address);

    // need to calculate minFee and maxFee from native to PMX
    const priceFeedETHPMX = await PrimexAggregatorV3TestServiceFactory.deploy("ETH_PMX", deployer.address);
    // 1 tta=0.2 pmx; 1 tta=0.3 eth -> 1 eth = 0.2/0.3 pmx
    await priceFeedETHPMX.setAnswer(parseUnits("0.666666666666666666", 18));
    await priceFeedETHPMX.setDecimals(decimalsPMX);
    await priceOracle.updatePriceFeed(await priceOracle.eth(), PMXToken.address, priceFeedETHPMX.address);

    const tokenUSD = await getContract("USD Coin");
    const priceFeedTTDUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTD_USD", deployer.address);
    await priceFeedTTDUSD.setAnswer(parseUnits("1", "8"));
    await priceFeedTTDUSD.setDecimals("8");
    await priceOracle.updatePriceFeed(testTokenD.address, tokenUSD.address, priceFeedTTDUSD.address);

    await positionManager.setMaxPositionSize(testTokenC.address, testTokenD.address, 0, MaxUint256);
    //
    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  function calculateFee(amount, rate, price) {
    const feeAmount = wadMul(amount.toString(), rate.toString()).toString();
    return BigNumber.from(wadMul(feeAmount.toString(), price.toString()).toString());
  }

  describe("openPosition", function () {
    let snapshotId, borrowedAmount, amountOutMin, takeDepositFromWallet, payFeeFromWallet, amountDOut, marginParams;
    before(async function () {
      borrowedAmount = BigNumber.from(0);
      amountOutMin = BigNumber.from(0);
      takeDepositFromWallet = true;
      payFeeFromWallet = true;

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);

      amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);

      marginParams = {
        bucket: "",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetRoutes: [],
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

    it("Should revert openPosition when firstAssetRoutes is empty list and it's spot", async function () {
      const deadline = new Date().getTime() + 600;

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: [],
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });

    it("Should revert openPosition when depositInThirdAssetRoutes is not empty list and it's spot", async function () {
      const deadline = new Date().getTime() + 600;

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: firstAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0");
    });

    it("Should revert openPosition when depositAsset is equal positionAsset", async function () {
      const deadline = new Date().getTime() + 600;

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenC.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_BE_DIFFERENT_ASSETS_IN_SPOT");
    });

    it("Should revert openPosition when position asset doesn't have oracle price feed with the deposit asset.", async function () {
      const deadline = new Date().getTime() + 600;
      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NO_PRICEFEED_FOUND");
    });

    it("Should create 'Position' and swap trader deposit", async function () {
      const deadline = new Date().getTime() + 600;

      await expect(() =>
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.changeTokenBalances(testTokenD, [pair, positionManager], [amountDOut.mul(NegativeOne), amountDOut]);
    });
    it("Should create 'Position' and transfer depositAmount from trader", async function () {
      const deadline = new Date().getTime() + 600;

      await expect(() =>
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.changeTokenBalances(testTokenC, [trader, pair], [depositAmount.mul(NegativeOne), depositAmount]);
    });
    it("Should create position and increase traders count, and add traderPositions", async function () {
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      const timestamp = (await provider.getBlock("latest")).timestamp;

      const position = await positionManager.getPosition(0);
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
        extraParams: "0x",
      };
      parseArguments(position, expectedPosition);
    });

    it("Should open position and throw event", async function () {
      const deadline = new Date().getTime() + 600;
      const positionId = 0;
      const amount0Out = await getAmountsOut(dex, borrowedAmount.add(depositAmount), [testTokenC.address, testTokenD.address]);
      const entryPrice = wadDiv(borrowedAmount.add(depositAmount).toString(), amount0Out.toString()).toString();
      const leverage = wadDiv(borrowedAmount.add(depositAmount).toString(), depositAmount.toString()).toString();

      const txOpenPosition = await positionManager.connect(trader).openPosition(
        {
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );

      const position = await positionManager.getPosition(0);

      const expectedArguments = {
        positionId: positionId,
        trader: trader.address,
        openedBy: trader.address,
        position: position,
        feeToken: NATIVE_CURRENCY,
        protocolFee: feeAmountInEth,
        entryPrice: entryPrice,
        leverage: leverage,
        closeConditions: [],
      };

      eventValidation("OpenPosition", await txOpenPosition.wait(), expectedArguments);
    });

    it("Should open position with stopLoss price < currentPrice", async function () {
      const deadline = new Date().getTime() + 600;
      const stopLossPrice = wadDiv(depositAmount.toString(), amountDOut.toString()).toString();

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [
              getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, BigNumber.from(stopLossPrice).sub(3))),
            ],
          },
          { value: feeAmountInEth },
        ),
      ).to.emit(positionManager, "OpenPosition");
    });

    it("Should transfer tokens from traderBalanceVault when openPosition with takeDepositFromWallet is false", async function () {
      const deadline = new Date().getTime() + 600;

      await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

      const { availableBalance: traderAvailableBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenC.address);

      const tx = positionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetRoutes: firstAssetRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: amountOutMin,
        deadline: deadline,
        takeDepositFromWallet: false,
        payFeeFromWallet: false,
        closeConditions: [],
      });

      await expect(() => tx)
        .to.changeTokenBalance(testTokenC, traderBalanceVault, depositAmount.mul(NegativeOne))
        .to.changeEtherBalances([traderBalanceVault, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);

      const { availableBalance: traderAvailableBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(traderAvailableBalanceBefore.sub(traderAvailableBalanceAfter)).to.equal(depositAmount);
    });

    it("Should revert openPosition with fee in PMX when user balance in traderBalanceVault doesn't have enough pmx with takeDepositFromWallet is false", async function () {
      const deadline = new Date().getTime() + 600;

      await expect(
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: false,
          payFeeFromWallet: false,
          closeConditions: [],
          isProtocolFeeInPmx: true,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_FREE_ASSETS");
    });

    it("Should revert openPosition with fee in PMX when user balance in traderBalanceVault doesn't have enough protocolFee assets (pmx)", async function () {
      const deadline = new Date().getTime() + 600;
      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(positionManager.address, feeAmountInPmx);
      await expect(() =>
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [],
          isProtocolFeeInPmx: true,
        }),
      ).to.changeTokenBalances(PMXToken, [trader, Treasury], [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx]);
    });
    it("Should openPosition with fee in PMX from vault", async function () {
      const deadline = new Date().getTime() + 600;
      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
      await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);
      const { availableBalance: traderAvailableBalanceBefore } = await traderBalanceVault.balances(trader.address, PMXToken.address);

      await expect(() =>
        positionManager.connect(trader).openPosition({
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: false,
          payFeeFromWallet: false,
          closeConditions: [],
          isProtocolFeeInPmx: true,
        }),
      ).to.changeTokenBalances(PMXToken, [traderBalanceVault, Treasury], [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx]);

      const { availableBalance: traderAvailableBalanceAfter } = await traderBalanceVault.balances(trader.address, PMXToken.address);
      expect(traderAvailableBalanceBefore.sub(traderAvailableBalanceAfter)).to.equal(feeAmountInPmx);
    });
  });

  describe("openPosition with minPositionSize", function () {
    let snapshotId, borrowedAmount, takeDepositFromWallet, deadline, tokenWETH, marginParams;
    before(async function () {
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = true;
      borrowedAmount = 0;

      await priceFeed.setDecimals("18");

      tokenWETH = await getContract("Wrapped Ether");

      const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
      const priceFeedTTAWETH = await PrimexAggregatorV3TestServiceFactory.deploy(
        "PrimexAggregatorV3TestService TTA_WETH",
        deployer.address,
      );
      await priceOracle.updatePriceFeed(testTokenC.address, tokenWETH.address, priceFeedTTAWETH.address);
      await priceFeedTTAWETH.setAnswer(parseEther("1"));
      await priceFeedTTAWETH.setDecimals("18");

      marginParams = {
        bucket: "",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetRoutes: [],
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
      const depositAmount = parseEther("3");

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);
      await positionManager.setMinPositionSize(parseEther("4"), tokenWETH.address);

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: false,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
    });

    it("Should open position when position size >= minPositionSize", async function () {
      const depositAmount = parseEther("4");
      const feeAmount = wadMul(
        depositAmount.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(feeAmount));
      await positionManager.setMinPositionSize(parseEther("4"), tokenWETH.address);

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: takeDepositFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.emit(positionManager, "OpenPosition");
    });
  });

  describe("openPosition with maxPositionSize", function () {
    let snapshotId, borrowedAmount, takeDepositFromWallet, payFeeFromWallet, deadline, tokenWETH, marginParams;
    before(async function () {
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = true;
      payFeeFromWallet = true;
      borrowedAmount = 0;

      await priceFeed.setDecimals("18");

      tokenWETH = await getContract("Wrapped Ether");

      const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
      const priceFeedTTAWETH = await PrimexAggregatorV3TestServiceFactory.deploy(
        "PrimexAggregatorV3TestService TTA_WETH",
        deployer.address,
      );
      await priceOracle.updatePriceFeed(testTokenC.address, tokenWETH.address, priceFeedTTAWETH.address);
      await priceFeedTTAWETH.setAnswer(parseEther("1"));
      await priceFeedTTAWETH.setDecimals("18");

      marginParams = {
        bucket: "",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetRoutes: [],
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

    it("Should revert when position size > maxPositionSize", async function () {
      const depositAmount = parseEther("3");

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);
      await positionManager.setMaxPositionSize(testTokenC.address, testTokenD.address, 0, amountDOut.sub(1));
      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_SIZE_EXCEEDED");
    });

    it("Should open position when position size <= maxPositionSize", async function () {
      const depositAmount = parseEther("4");
      const feeAmount = wadMul(
        depositAmount.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(feeAmount));
      await positionManager.setMaxPositionSize(testTokenC.address, testTokenD.address, 0, amountDOut);

      await expect(
        positionManager.connect(trader).openPosition(
          {
            marginParams: marginParams,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            amountOutMin: 0,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: takeDepositFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        ),
      ).to.emit(positionManager, "OpenPosition");
    });
  });

  describe("closePosition", function () {
    let snapshotId;
    before(async function () {
      const borrowedAmount = 0;
      const amountOutMin = 0;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;

      const feeAmount = wadMul(
        depositAmount.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(feeAmount));

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );

      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const amountCOutInWadDecimals = amountCOut.mul(multiplierC);
      const positionAmountInWadDecimals = positionAmount.mul(multiplierD);

      let price = wadDiv(positionAmountInWadDecimals.toString(), amountCOutInWadDecimals.toString()).toString();
      price = BigNumber.from(price).div(multiplierD);
      await priceFeed.setAnswer(price);
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
      await expect(positionManager.connect(trader).closePosition(0, trader.address, [], 0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
      );
    });

    it("Should close position and transfer testTokenD from 'PositionManager' to 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalances(
        testTokenD,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should close position and transfer testTokenC from 'Pair' to 'traderBalanceVault'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      if (dex === "quickswapv3") {
        const balancePairBefore = await testTokenC.balanceOf(pair.address);
        const balanceTraderBalanceVaultBefore = await testTokenC.balanceOf(traderBalanceVault.address);
        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);
        const balancePairAfter = await testTokenC.balanceOf(pair.address);
        const balanceTraderBalanceVaultAftet = await testTokenC.balanceOf(traderBalanceVault.address);
        const delta = wadMul(amountCOut.toString(), parseEther("0.01").toString()).toString();
        expect(balancePairAfter).to.be.closeTo(balancePairBefore.sub(amountCOut), delta);
        expect(balanceTraderBalanceVaultAftet).to.be.closeTo(balanceTraderBalanceVaultBefore.add(amountCOut), delta);
      } else {
        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalances(
          testTokenC,
          [pair, traderBalanceVault],
          [amountCOut.mul(NegativeOne), amountCOut],
        );
      }
    });

    it("Should close position and delete trader position from traderPositions list", async function () {
      await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should close position and update available balance of trader's tokens in trader balance Vault", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);

      const { availableBalance: availableABefore } = await traderBalanceVault.balances(trader.address, testTokenC.address);

      await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

      const { availableBalance: availableAAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);

      expect(availableABefore).to.equal(0);

      if (dex === "quickswapv3") {
        const delta = wadMul(amountCOut.toString(), parseEther("0.01").toString()).toString();
        expect(availableAAfter).to.be.closeTo(amountCOut, delta);
      } else {
        expect(availableAAfter).to.equal(amountCOut);
      }
    });

    it("Should close position and throw event", async function () {
      await network.provider.send("evm_mine");

      const { positionAmount, depositAmountInSoldAsset } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const profit = amountCOut.sub(depositAmountInSoldAsset);

      const tx = await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);
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
        amountOut: amountCOut,
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
      await setBadOraclePrice(priceFeed, fivePercent, false);
      expect(await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0));
    });

    it("Should NOT revert partially close position when prices on dex and oracle are different", async function () {
      await setBadOraclePrice(priceFeed, fivePercent, false);
      const amount = parseEther("0.1");
      expect(await positionManager.connect(trader).partiallyClosePosition(0, amount, trader.address, routesForClose, 0));
    });

    it("Should partially close spot position", async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();
      const amount = parseEther("0.1");
      const minPositionSize = 0;
      const amountInBorrowed = await getAmountsOut(dex, amount, [testTokenD.address, testTokenC.address]);
      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      const positionBefore = await positionManager.getPosition(0);

      await expect(() =>
        positionManager.connect(trader).partiallyClosePosition(0, amount, trader.address, routesForClose, minPositionSize),
      ).to.changeTokenBalance(testTokenC, traderBalanceVault, amountInBorrowed);

      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(availableAfter).to.equal(availableBefore.add(amountInBorrowed));
      const position = await positionManager.getPosition(0);
      expect(position.positionAmount).to.be.equal(positionBefore.positionAmount.sub(amount));
      expect(position.scaledDebtAmount).to.be.equal(0);
    });
  });

  describe("liquidatePosition by SL/TP", function () {
    let borrowedAmount,
      amountOutMin,
      deadline,
      takeDepositFromWallet,
      payFeeFromWallet,
      snapshotId,
      stopLossPrice,
      takeProfitPrice,
      additionalParams,
      conditionIndex;
    before(async function () {
      conditionIndex = 0;
      borrowedAmount = 0;
      amountOutMin = 0;
      takeDepositFromWallet = true;
      payFeeFromWallet = true;

      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(depositAmount));

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);
      stopLossPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString()).sub("10");
      takeProfitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString()).add("10");
      deadline = new Date().getTime() + 600;

      const feeAmountCalculateWithETHRate = wadMul(
        depositAmount.add(borrowedAmount).toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        },
        { value: feeAmountInEth },
      );

      await priceFeed.setAnswer(BigNumber.from(limitPrice).mul(2));

      additionalParams = getTakeProfitStopLossAdditionalParams(routesForClose);
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

    it("Should close position by stop loss and transfer testTokenD from 'PositionManager' to 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      await expect(() =>
        positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, conditionIndex, "0x", CloseReason.LIMIT_CONDITION, []),
      ).to.changeTokenBalances(testTokenD, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmount]);
    });

    it("Should close position by stop loss and transfer testTokenC from 'Pair' to 'traderBalanceVault'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);

      await expect(() =>
        positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, conditionIndex, "0x", CloseReason.LIMIT_CONDITION, []),
      ).to.changeTokenBalances(testTokenC, [pair, traderBalanceVault], [amount0Out.mul(NegativeOne), amount0Out]);
    });

    it("Should liquidate position by stop loss and correctly updated balances in the vault", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.equal(true);

      await expect(() =>
        positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, conditionIndex, "0x", CloseReason.LIMIT_CONDITION, []),
      ).to.changeTokenBalance(testTokenC, traderBalanceVault, amountCOut);

      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(traderBalance).to.be.equal(amountCOut);
    });

    it("Should liquidate position by take profit and correctly updated balances in the vault", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseEther("4").toString(),
        path: [testTokenC.address, testTokenD.address],
      });
      const { positionAmount } = await positionManager.getPosition(0);

      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);

      await expect(() =>
        positionManager
          .connect(liquidator)
          .closePositionByCondition(
            0,
            liquidator.address,
            routesForClose,
            conditionIndex,
            additionalParams,
            CloseReason.LIMIT_CONDITION,
            [],
          ),
      ).to.changeTokenBalance(testTokenC, traderBalanceVault, amountCOut);

      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
      expect(traderBalance).to.be.equal(amountCOut);
    });

    it("Should liquidate position by stop loss and throw event", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);

      const tx = await positionManager
        .connect(liquidator)
        .closePositionByCondition(0, liquidator.address, routesForClose, conditionIndex, "0x", CloseReason.LIMIT_CONDITION, []);
      const thReceipt = await tx.wait();

      const profit = amountCOut.sub(depositAmount);

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
        amountOut: amountCOut,
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
      const payFeeFromWallet = true;

      const feeAmountCalculateWithETHRate = wadMul(
        depositAmount.add(borrowedAmount).toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();

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
      await priceFeed.setAnswer(limitPrice);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
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
        routes: routesForClose,
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
        routes: dex2Route,
      };
      parseArguments(bestShares, bestRoute);
    });
  });

  describe("getBestDexForOpenablePosition", function () {
    let snapshotId, dexesWithAncillaryData, getBestDexForOpenablePositionData, expectedBestShares;
    before(async function () {
      // const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
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
        depositInThirdAssetReturnParams: { returnAmount: 0, estimateGasAmount: 0, routes: [] },
        depositToBorrowedReturnParams: { returnAmount: 0, estimateGasAmount: 0, routes: [] },
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
        routes: firstAssetRoutes,
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
        routes: await getSingleRoute([testTokenC.address, testTokenD.address], dex2),
      };

      parseArguments(bestShares, expectedBestShares);
    });
  });

  describe("getCurrentPriceAndProfitByPosition", function () {
    let snapshotId, dexesWithAncillaryData;

    // eslint-disable-next-line mocha/no-hooks-for-single-case
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
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount);
      const borrowedAmount = 0;
      const amountOutMin = 0;
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;

      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();

      await priceFeed.setAnswer(limitPrice);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
    });

    // eslint-disable-next-line mocha/no-hooks-for-single-case
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

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Return correct profit and current price", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountCOut1 = await getAmountsOut(dex, positionAmount, [testTokenD.address, testTokenC.address]);
      const amountCOut2 = await getAmountsOut(dex2, positionAmount, [testTokenD.address, testTokenC.address]);

      const amountOut = amountCOut1.gt(amountCOut2) ? amountCOut1 : amountCOut2;
      const expectedPorfit = amountOut.sub(depositAmount);
      const currentPrice = wadDiv(amountOut.toString(), positionAmount.toString()).toString();
      const data = await bestDexLens.callStatic.getCurrentPriceAndProfitByPosition(positionManager.address, 0, 1, dexesWithAncillaryData);
      expect(data[0]).to.equal(currentPrice);
      expect(data[1]).to.equal(expectedPorfit);
    });
  });

  describe("canBeClosed", function () {
    let borrowedAmount, amountDOut, depositAmount, amountOutMin, deadline, takeDepositFromWallet, snapshotId, exchangeRate;

    before(async function () {
      depositAmount = parseEther("15");
      borrowedAmount = 0;
      amountOutMin = 0;
      deadline = new Date().getTime() + 600;
      takeDepositFromWallet = true;
      const feeAmount = wadMul(
        depositAmount.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(feeAmount));

      amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());

      await priceFeed.setAnswer(exchangeRate);
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

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        },
        { value: feeAmountInEth },
      );
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.be.equal(false);
    });

    it("isStopLossReached should return 'true' when oracle price <= stopLossPrice", async function () {
      const stopLossPrice = wadDiv(WAD, exchangeRate.add("1").toString()).toString();

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
        },
        { value: feeAmountInEth },
      );

      await priceFeed.setAnswer(exchangeRate.add("2"));
      expect(await primexLens.isStopLossReached(pmAddress, 0)).to.be.equal(true);
    });

    it("isTakeProfitReached should return 'false' when takeProfitPrice >= price on dex", async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();
      const positionAmount = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const currentPrice = wadDiv(depositAmount.toString(), positionAmount.toString()).toString();

      // increase price for 0.1% to conform possible pool fee influence
      const takeProfitPrice = wadMul(currentPrice.toString(), parseEther("1.001").toString()).toString();

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
        },
        { value: feeAmountInEth },
      );

      expect(await primexLens.callStatic.isTakeProfitReached(pmAddress, 0, routesForClose)).to.be.equal(false);
    });

    it("isTakeProfitReached should return 'true' when takeProfitPrice <= price on dex", async function () {
      const positionAmount = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      const currentPrice = wadDiv(depositAmount.toString(), positionAmount.toString()).toString();
      const takeProfitPrice = wadMul(currentPrice, parseEther("1.01").toString()).toString();
      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: takeDepositFromWallet,
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, 0))],
        },
        { value: feeAmountInEth },
      );

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseEther("4").toString(),
        path: [testTokenC.address, testTokenD.address],
      });
      // when takeProfitAmount < expectedBorrowedAssetAmount;
      expect(await primexLens.callStatic.isTakeProfitReached(pmAddress, 0, routesForClose)).to.be.equal(true);
    });
  });

  describe("Limit Order", function () {
    let snapshotId, leverage, takeDepositFromWallet, payFeeFromWallet, snapshotIdBase2;
    before(async function () {
      leverage = parseEther("1");
      takeDepositFromWallet = true;
      payFeeFromWallet = true;

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
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "",
              depositAsset: testTokenC.address,
              depositAmount: depositAmount,
              positionAsset: testTokenC.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: takeDepositFromWallet,
              closeConditions: [],
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
              leverage: leverage,
              shouldOpenPosition: true,
            },
            { value: feeAmountInEthForLimitOrders },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SHOULD_BE_DIFFERENT_ASSETS_IN_SPOT");
      });

      it("Should revert when leverage is not 1", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "",
              depositAsset: testTokenC.address,
              depositAmount: depositAmount,
              positionAsset: testTokenD.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
              leverage: parseEther("2"),
              shouldOpenPosition: true,
            },
            { value: feeAmountInEthForLimitOrders },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "LEVERAGE_SHOULD_BE_1");
      });

      it("Should revert when position asset doesn't have oracle price feed with the deposit asset.", async function () {
        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
        const deadline = new Date().getTime() + 600;
        await expect(
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "",
              depositAsset: testTokenC.address,
              depositAmount: depositAmount,
              positionAsset: testTokenB.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
              leverage: leverage,
              shouldOpenPosition: true,
            },
            { value: feeAmountInEthForLimitOrders },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "NO_PRICEFEED_FOUND");
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
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "",
              depositAsset: testTokenC.address,
              depositAmount: depositAmount,
              positionAsset: testTokenD.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
              leverage: leverage,
              shouldOpenPosition: true,
            },
            { value: feeAmountInEthForLimitOrders },
          ),
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
        const payFeeFromWallet = false;
        await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEthForLimitOrders });
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(depositAmount);
        expect(lockedBefore).to.equal(0);

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          },
          { value: feeAmountInEthForLimitOrders },
        );

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

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
            closeConditions: [
              getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
            ],
          },
          { value: feeAmountInEthForLimitOrders },
        );
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
          feeToken: NATIVE_CURRENCY,
          protocolFee: feeAmountInEthForLimitOrders,
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
        await PMXToken.transfer(trader.address, feeAmountInPmxForLimitOrders);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmxForLimitOrders);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
          ],
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
          protocolFee: feeAmountInPmxForLimitOrders,
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
        const payFeeFromWallet = false;

        await testTokenC.connect(trader).approve(traderBalanceVault.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(testTokenC.address, depositAmount);

        await PMXToken.transfer(trader.address, feeAmountInPmxForLimitOrders);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmxForLimitOrders);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmxForLimitOrders);
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
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(parseEther("1")))],
          closeConditions: [
            getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(parseEther("2"), parseEther("1").sub("1"))),
          ],
        });
        const orderCreatedAt = (await provider.getBlock("latest")).timestamp;
        const order = await limitOrderManager.getOrder(1);

        const expectedOrder = {
          bucket: AddressZero,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: feeAmountInPmxForLimitOrders,
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
        await PMXToken.transfer(trader.address, feeAmountInPmxForLimitOrders);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmxForLimitOrders);

        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          isProtocolFeeInPmx: true,
        });

        const orderObject = {
          bucket: (await limitOrderManager.getOrder(orderId)).bucket,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: feeAmountInPmxForLimitOrders,
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
        const pmxFee = calculateFee(depositAmount, await PrimexDNS.feeRates(OrderType.SWAP_LIMIT_ORDER, PMXToken.address), PriceInPMX);
        await PMXToken.transfer(trader.address, pmxFee);
        await PMXToken.connect(trader).approve(limitOrderManager.address, pmxFee);

        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: false,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
          closeConditions: [],
          isProtocolFeeInPmx: true,
        });

        const orderObject = {
          bucket: (await limitOrderManager.getOrder(orderId)).bucket,
          positionAsset: testTokenD.address,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          feeToken: PMXToken.address,
          protocolFee: pmxFee,
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
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "",
              depositAsset: testTokenC.address,
              depositAmount: depositAmount,
              positionAsset: testTokenD.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              leverage: leverage,
              shouldOpenPosition: true,
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
              closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, stopLossPrice))],
            },
            { value: feeAmountInEthForLimitOrders },
          ),
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
        payFeeFromWallet = true;
        const txCreateLimitOrder = await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
          },
          { value: feeAmountInEthForLimitOrders },
        );
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
      let tokenWETH, priceFeedTTAWETH, wethExchangeRate, additionalParams;

      before(async function () {
        tokenWETH = await getContract("Wrapped Ether");
        const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
        priceFeedTTAWETH = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTA_WETH", trader.address);
        await priceOracle.updatePriceFeed(testTokenC.address, tokenWETH.address, priceFeedTTAWETH.address);
        wethExchangeRate = parseEther("1");
        await priceFeedTTAWETH.setAnswer(wethExchangeRate);
        await priceFeedTTAWETH.setDecimals("18");

        additionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);
      });

      it("Should revert when depositAmount < minPositionSize", async function () {
        await positionManager.setMinPositionSize(depositAmount.add(parseEther("1")), tokenWETH.address);
        const deadline = new Date().getTime() + 600;

        await expect(
          limitOrderManager.connect(trader).createLimitOrder({
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });

      it("Should create limit order when position size >= minPositionSize", async function () {
        await positionManager.setMinPositionSize(depositAmount, tokenWETH.address);
        const deadline = new Date().getTime() + 600;

        await expect(
          limitOrderManager.connect(trader).createLimitOrder(
            {
              bucket: "",
              depositAsset: testTokenC.address,
              depositAmount: depositAmount,
              positionAsset: testTokenD.address,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
              closeConditions: [],
              leverage: leverage,
              shouldOpenPosition: true,
            },
            { value: feeAmountInEthForLimitOrders },
          ),
        ).to.emit(limitOrderManager, "CreateLimitOrder");
      });

      it("Should return false in canBeFilled when depositAmount < minPositionSize", async function () {
        await positionManager.setMinPositionSize(depositAmount, tokenWETH.address);
        const deadline = new Date().getTime() + 600;

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          },
          { value: feeAmountInEthForLimitOrders },
        );
        const orderId = await limitOrderManager.ordersId();

        await priceFeedTTAWETH.setAnswer(BigNumber.from(wethExchangeRate).div(2));

        expect(await limitOrderManager.callStatic.canBeFilled(orderId, 0, additionalParams)).to.be.equal(false);
      });

      it("Should revert openPositionByOrder when position size < minPositionSize", async function () {
        await positionManager.setMinPositionSize(depositAmount, tokenWETH.address);
        const deadline = new Date().getTime() + 600;

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          },
          { value: feeAmountInEthForLimitOrders },
        );
        const orderId = await limitOrderManager.ordersId();

        await priceFeedTTAWETH.setAnswer(BigNumber.from(wethExchangeRate).div(2));

        await expect(
          limitOrderManager.openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: additionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
    });

    describe("canBeFilled", function () {
      let orderId1, orderId2, orderId3, params, defaultAdditionalParams, conditionIndex;
      before(async function () {
        conditionIndex = 0;
        const deadline = new Date().getTime() + 600;
        const leverage = parseEther("1");
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;

        const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        const exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        await priceFeed.setAnswer(exchangeRate);
        await priceFeed.setDecimals("18");

        const limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());

        await PMXToken.transfer(trader.address, feeAmountInPmxForLimitOrders);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmxForLimitOrders);

        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount.mul(3));
        await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: BigNumber.from(feeAmountInEth).mul(3) });
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          },
          { value: feeAmountInEthForLimitOrders },
        );

        orderId1 = await limitOrderManager.ordersId();

        await PMXToken.transfer(trader.address, feeAmountInPmxForLimitOrders);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmxForLimitOrders);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmxForLimitOrders);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          isProtocolFeeInPmx: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.add(1)))],
          closeConditions: [],
          leverage: leverage,
          shouldOpenPosition: true,
        });

        orderId2 = await limitOrderManager.ordersId();
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.sub(1)))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          },
          { value: feeAmountInEthForLimitOrders },
        );
        orderId3 = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);
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
        params = {
          orderId: orderId2,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        };
      });

      it("Should revert when firstAssetRoutes length is empty", async function () {
        const additionalParams = getLimitPriceAdditionalParams([], [], []);
        await expect(
          limitOrderManager.connect(liquidator).callStatic.canBeFilled(orderId2, conditionIndex, additionalParams),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
        params.firstAssetRoutes = [];
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
        );
      });

      it("Should return true when limitPrice is less than current price on dex and trader has enough pmx in traderBalanceVault", async function () {
        expect(
          await limitOrderManager.connect(liquidator).callStatic.canBeFilled(orderId2, conditionIndex, defaultAdditionalParams),
        ).to.be.equal(true);
        await limitOrderManager.connect(liquidator).openPositionByOrder(params);
      });

      it("Should return true when limitPrice is current price on dex ", async function () {
        params.orderId = orderId1;
        expect(
          await limitOrderManager.connect(liquidator).callStatic.canBeFilled(orderId1, conditionIndex, defaultAdditionalParams),
        ).to.be.equal(true);
        await limitOrderManager.connect(liquidator).openPositionByOrder(params);
      });

      it("Should return false when limitPrice is more than current price on dex ", async function () {
        params.orderId = orderId3;
        expect(
          await limitOrderManager.connect(liquidator).callStatic.canBeFilled(orderId3, conditionIndex, defaultAdditionalParams),
        ).to.be.equal(false);
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_CAN_NOT_BE_FILLED",
        );
      });
      it("Should return false when limitPrice > current price(10) but deadline < block.timestamp", async function () {
        await network.provider.send("evm_setNextBlockTimestamp", [new Date().getTime() + 800]);
        await network.provider.send("evm_mine");
        expect(
          await limitOrderManager.connect(liquidator).callStatic.canBeFilled(orderId2, conditionIndex, defaultAdditionalParams),
        ).to.be.equal(false);
        await expect(limitOrderManager.connect(liquidator).callStatic.openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_HAS_EXPIRED",
        );
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
        defaultAdditionalParams;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        borrowedAmount = BigNumber.from(0);
        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
        availableBeforeAll = availableBalance;
        lockedBeforeAll = lockedBalance;

        amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        await priceFeed.setAnswer(exchangeRate);
        await priceFeed.setDecimals(18);

        limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());
        const difference = parseEther("1");
        slPrice = limitPrice.sub(difference);
        tpPrice = limitPrice.add(difference);
        closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))];
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: closeConditions,
          },
          { value: feeAmountInEthForLimitOrders },
        );
        orderId = await limitOrderManager.ordersId();
        order = await limitOrderManager.getOrder(1);

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);
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

      it("Should revert openPositionByOrder when firstAssetRoutes is empty list", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: [],
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should revert openPositionByOrder when depositInThirdAssetRoutes is not empty list", async function () {
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: firstAssetRoutes,
            keeper: liquidator.address,
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
        await priceFeed.setAnswer(exchangeRate);
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_CAN_NOT_BE_FILLED");
      });

      it("Should create position by order and transfer testTokenC from 'Bucket' to 'Pair'", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalances(testTokenC, [traderBalanceVault, pair], [depositAmount.mul(NegativeOne.toString()), depositAmount]);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order and transfer testTokenD to 'PositionManager'", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalance(testTokenD, positionManager, amountDOut);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order, increase traders count, add traderPositions and then deleted the order", async function () {
        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });

        const positionCreatedAt = (await provider.getBlock("latest")).timestamp;

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

        const position = await positionManager.getPosition(0);
        expect(order.createdAt).to.lt(position.createdAt);

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
          createdAt: positionCreatedAt,
          updatedConditionsAt: positionCreatedAt,
          extraParams: "0x",
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

        const tx = await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });

        const position = await positionManager.getPosition(0);

        const expectedArguments = {
          positionId: positionId,
          trader: trader.address,
          openedBy: liquidator.address,
          position: position,
          feeToken: NATIVE_CURRENCY,
          protocolFee: feeAmountInEthForLimitOrders,
          entryPrice: entryPrice,
          leverage: leverage,
          closeConditions: closeConditions,
        };

        eventValidation("OpenPosition", await tx.wait(), expectedArguments, positionManager);
      });

      it("Should open position by order and throw event 'CloseLimitOrder'", async function () {
        const closeReasonFilledSpot = 1;
        const newPositionID = await positionManager.positionsId();
        const txCloseLimitOrder = await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
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

      it("Should open position by order and lock trader deposit in traderBalanceVault", async function () {
        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );
        expect(availableBefore).to.equal(availableBeforeAll);
        expect(lockedBefore).to.equal(lockedBeforeAll.add(depositAmount));
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.changeEtherBalances(
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInEthForLimitOrders).mul(NegativeOne), feeAmountInEthForLimitOrders],
        );
        const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenC.address);

        expect(availableAfter).to.equal(availableBefore);
      });

      it("Should open position by order when isProtocolFeeInPmx=true", async function () {
        // second order with isProtocolFeeInPmx=true
        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
        await PMXToken.transfer(trader.address, feeAmountInPmxForLimitOrders);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmxForLimitOrders);
        const deadline = new Date().getTime() + 600;

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
        });
        const orderId = await limitOrderManager.ordersId();

        const { availableBalance: availableBefore, lockedBalance: lockedBefore } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );

        const { lockedBalance: pmxLockedBefore } = await traderBalanceVault.balances(trader.address, PMXToken.address);
        expect(availableBefore).to.equal(availableBeforeAll);
        expect(lockedBefore).to.equal(lockedBeforeAll.add(depositAmount).add(depositAmount));
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
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
        const { lockedBalance: pmxLockedAfter } = await traderBalanceVault.balances(trader.address, PMXToken.address);

        expect(pmxLockedBefore.sub(pmxLockedAfter)).to.equal(feeAmountInPmxForLimitOrders);
      });
    });

    describe("openPositionByOrder - swap order", function () {
      let orderId, exchangeRate, limitPrice, amountDOut, defaultAdditionalParams;
      before(async function () {
        const deadline = new Date().getTime() + 600;

        // const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenC.address);
        // availableBeforeAll = availableBalance;
        // lockedBeforeAll = lockedBalance;

        amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
        exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
        await priceFeed.setAnswer(exchangeRate);
        await priceFeed.setDecimals(18);

        limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: false,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [],
          },
          { value: feeAmountInEthForLimitOrders },
        );
        orderId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);
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
        await priceFeed.setAnswer(exchangeRate);
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ORDER_CAN_NOT_BE_FILLED");
      });

      it("Should not create position by order and transfer testTokenC from 'Bucket' to 'Pair'", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
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

        const feeInEth = calculateFee(depositAmount, await PrimexDNS.feeRates(OrderType.SWAP_LIMIT_ORDER, NATIVE_CURRENCY), PriceInETH);

        const tx = await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });

        await expect(() => tx)
          .to.changeTokenBalance(testTokenD, traderBalanceVault, amountDOut)
          .to.changeEtherBalances([traderBalanceVault, Treasury], [BigNumber.from(feeInEth).mul(NegativeOne), feeInEth]);

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

        expect(availableAfterD).to.equal(amountDOut);
        expect(lockedAfterD).to.equal(0);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });

      it("Should check the tolerable limit when executing the swap order", async function () {
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenC.address, testTokenD.address, parseEther("0.000001"));
        await swapExactTokensForTokens({
          dex: dex,
          amountIn: parseUnits("8", decimalsC),
          path: [testTokenC.address, testTokenD.address],
        });
        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should not create position by order and transfer testTokenD to traderBalanceVault, update trader balance in traderBalanceVault. protocolFeeInPmx=true", async function () {
        // second order with isProtocolFeeInPmx=true
        await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
        const deadline = new Date().getTime() + 600;
        const feeInPmx = calculateFee(depositAmount, await PrimexDNS.feeRates(OrderType.SWAP_LIMIT_ORDER, PMXToken.address), PriceInPMX);
        await PMXToken.transfer(trader.address, feeInPmx);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeInPmx);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: false,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [],
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
        const { lockedBalance: lockedBeforePMX } = await traderBalanceVault.balances(trader.address, PMXToken.address);
        expect(availableBeforeC).to.equal(0);
        expect(lockedBeforeC).to.equal(depositAmount.add(depositAmount));

        expect(availableBeforeD).to.equal(0);
        expect(lockedBeforeD).to.equal(0);
        const tx = limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });
        await expect(() => tx)
          .to.changeTokenBalance(testTokenD, traderBalanceVault, amountDOut)
          .changeTokenBalances(PMXToken, [traderBalanceVault, Treasury], [BigNumber.from(feeInPmx).mul(NegativeOne), feeInPmx]);

        const { availableBalance: availableAfterC, lockedBalance: lockedAfterC } = await traderBalanceVault.balances(
          trader.address,
          testTokenC.address,
        );

        const { availableBalance: availableAfterD, lockedBalance: lockedAfterD } = await traderBalanceVault.balances(
          trader.address,
          testTokenD.address,
        );

        const { lockedBalance: lockedAfterPMX } = await traderBalanceVault.balances(trader.address, PMXToken.address);
        expect(availableAfterC).to.equal(0);
        expect(lockedAfterC).to.equal(depositAmount);

        expect(availableAfterD).to.equal(amountDOut);
        expect(lockedAfterD).to.equal(0);

        expect(lockedBeforePMX.sub(lockedAfterPMX)).to.equal(feeInPmx);
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });
      it("Should throw event 'CloseLimitOrder'", async function () {
        const closeReasonFilledSpot = 2;
        const newPositionID = await positionManager.positionsId();
        const txCloseLimitOrder = await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
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
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "",
            depositAsset: testTokenC.address,
            depositAmount: depositAmount,
            positionAsset: testTokenD.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(1))],
            closeConditions: [],
            leverage: leverage,
            shouldOpenPosition: true,
          },
          { value: feeAmountInEthForLimitOrders },
        );
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
          "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          limitOrderManager.address,
          1,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]);

        parseArguments(bestShares.firstAssetReturnParams, {
          returnAmount: amount0Out1,
          estimateGasAmount: await getGas(dex),
          routes: firstAssetRoutes,
        });
        parseArguments(bestShares.depositInThirdAssetReturnParams, {
          returnAmount: 0,
          estimateGasAmount: 0,
          routes: [],
        });
        parseArguments(bestShares.depositToBorrowedReturnParams, {
          returnAmount: 0,
          estimateGasAmount: 0,
          routes: [],
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
          "getBestDexByOrder((address,address,uint256,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          limitOrderManager.address,
          1,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]);

        parseArguments(bestShares.firstAssetReturnParams, {
          returnAmount: amount0Out2,
          estimateGasAmount: await getGas(dex2),
          routes: await getSingleRoute([testTokenC.address, testTokenD.address], dex2),
        });
        parseArguments(bestShares.depositInThirdAssetReturnParams, {
          returnAmount: 0,
          estimateGasAmount: 0,
          routes: [],
        });
        parseArguments(bestShares.depositToBorrowedReturnParams, {
          returnAmount: 0,
          estimateGasAmount: 0,
          routes: [],
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
      const payFeeFromWallet = true;
      await testTokenC.connect(trader).approve(positionManager.address, depositAmount.add(depositAmount));
      const amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);

      const limitPrice = wadDiv(amountDOut.toString(), depositAmount.toString()).toString();
      await priceFeed.setAnswer(limitPrice);
      const deadline = new Date().getTime() + 600;

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
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
      await expect(positionManager.connect(trader).decreaseDeposit(positionId, depositDecrease)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "IS_SPOT_POSITION",
      );
    });
  });

  describe("updateOrder", function () {
    let exchangeRate, leverage, limitPrice, amountDOut, stopLossPrice, takeProfitPrice;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      leverage = parseEther("1");
      const deadline = new Date().getTime() + 600;

      amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
      exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
      await priceFeed.setAnswer(exchangeRate);
      await priceFeed.setDecimals(18);

      limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());

      stopLossPrice = limitPrice.sub("100");
      takeProfitPrice = limitPrice.add("100");
      await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
      await limitOrderManager.connect(trader).createLimitOrder(
        {
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        },
        { value: feeAmountInEthForLimitOrders },
      );
    });

    it("Should revert when update leverage", async function () {
      const newLeverage = leverage.add(1);
      await testTokenC.connect(trader).approve(limitOrderManager.address, depositAmount);
      const deadline = new Date().getTime() + 600;

      await limitOrderManager.connect(trader).createLimitOrder(
        {
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: true,
          payFeeFromWallet: true,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))],
        },
        { value: feeAmountInEthForLimitOrders },
      );
      const orderId = await limitOrderManager.ordersId();

      await expect(
        limitOrderManager.connect(trader).updateOrder({
          bucket: "bucket1",
          orderId: orderId,
          depositAmount: depositAmount,
          leverage: newLeverage,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CANNOT_CHANGE_SPOT_ORDER_TO_MARGIN");
    });
  });
});
