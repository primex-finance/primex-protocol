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
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  CloseReason,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  NATIVE_CURRENCY,
  OrderType,
} = require("./utils/constants");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { setBadOraclePrice, fivePercent } = require("./utils/setBadOraclePrice");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("./utils/conditionParams");
const { getAmountsOut, addLiquidity, swapExactTokensForTokens, getPair, getEncodedPath, getSingleRoute } = require("./utils/dexOperations");
const { eventValidation, parseArguments } = require("./utils/eventValidation");

process.env.TEST = true;
describe("DepositAsset_isAssetNotFromSwapPair", function () {
  let priceFeed,
    priceFeedTTXTTB,
    priceFeedTTXTTA,
    PMXToken,
    dex1,
    dex2,
    positionManager,
    limitOrderManager,
    traderBalanceVault,
    primexPricingLibrary,
    primexPricingLibraryMock,
    Treasury,
    testTokenA,
    testTokenB,
    tokenWETH,
    bucket,
    firstAssetRoutes,
    depositInThirdAssetRoutes,
    routesForClose,
    wethExchangeRate,
    decimalsA,
    decimalsB,
    decimalsX,
    priceOracle;
  let deployer, trader, lender, liquidator, pair, pairXB, debtTokenA, testTokenX, snapshotIdBase, PrimexDNS, bucketAddress, ErrorsLibrary;
  let multiplierA, multiplierB, multiplierX;
  let protocolRate,
    protocolRateInPmx,
    limitOrderProtocolRate,
    limitOrderProtocolRateInPmx,
    ttxPriceInPMX,
    depositAmountX,
    borrowedAmount,
    amountOutMin,
    positionAmount,
    depositInBorrowedAmount,
    feeAmountInPmx,
    feeAmountInEth,
    PriceInETH;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender, liquidator } = await getNamedSigners());
    PrimexDNS = await getContract("PrimexDNS");
    positionManager = await getContract("PositionManager");
    limitOrderManager = await getContract("LimitOrderManager");
    traderBalanceVault = await getContract("TraderBalanceVault");
    ErrorsLibrary = await getContract("Errors");
    Treasury = await getContract("Treasury");
    PMXToken = await getContract("EPMXToken");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    await testTokenB.mint(trader.address, parseUnits("100", decimalsB));
    PrimexDNS = await getContract("PrimexDNS");
    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    const debtTokenAddress = await bucket.debtToken();
    debtTokenA = await getContractAt("DebtToken", debtTokenAddress);
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex1 = "uniswap";
      dex2 = process.env.DEX;
    } else {
      dex1 = "sushiswap";
      dex2 = "uniswap";
    }

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });

    await run("deploy:ERC20Mock", {
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: "18",
    });

    testTokenX = await getContract("TestTokenX");
    decimalsX = await testTokenX.decimals();
    await testTokenX.mint(lender.address, parseUnits("1000", decimalsX));
    await testTokenX.mint(trader.address, parseUnits("1000", decimalsX));

    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex1);
    depositInThirdAssetRoutes = await getSingleRoute([testTokenX.address, testTokenB.address], dex1);
    routesForClose = await getSingleRoute([testTokenB.address, testTokenA.address], dex1);

    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenB, tokenB: testTokenX });

    await addLiquidity({ dex: dex2, amountADesired: "5", from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, amountADesired: "5", from: "lender", tokenA: testTokenA, tokenB: testTokenX });
    await addLiquidity({ dex: dex2, amountADesired: "5", from: "lender", tokenA: testTokenB, tokenB: testTokenX });

    const pairAddress = await getPair(dex1, testTokenA.address, testTokenB.address);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);
    const pairXBAddress = await getPair(dex1, testTokenX.address, testTokenB.address);
    pairXB = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairXBAddress);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");

    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);
    const tokenUSD = await getContract("USD Coin");
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    priceFeedTTXTTB = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTB", deployer.address);
    priceFeedTTXTTA = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTA", deployer.address);
    const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTB_USD", deployer.address);
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    const priceFeedTTXETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_ETH", deployer.address);
    await priceFeedTTBUSD.setAnswer(parseUnits("1", "8"));
    await priceFeedTTBUSD.setDecimals("8");

    PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(PriceInETH);

    await priceFeedTTXETH.setDecimals("18");
    await priceFeedTTXETH.setAnswer(PriceInETH);

    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenX.address, await priceOracle.eth(), priceFeedTTXETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, await priceOracle.eth(), priceFeedTTXETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenX.address, priceFeedTTXTTB.address);
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenX.address, priceFeedTTXTTA.address);
    await priceOracle.updatePriceFeed(testTokenB.address, tokenUSD.address, priceFeedTTBUSD.address);
    const decimalsPMX = await PMXToken.decimals();

    // need to calculate minFee and maxFee from native to PMX
    const priceFeedETHPMX = await PrimexAggregatorV3TestServiceFactory.deploy("ETH_PMX", deployer.address);
    // 1 tta=0.2 pmx; 1 tta=0.3 eth -> 1 eth = 0.2/0.3 pmx
    await priceFeedETHPMX.setAnswer(parseUnits("0.666666666666666666", 18));
    await priceFeedETHPMX.setDecimals(decimalsPMX);
    await priceOracle.updatePriceFeed(await priceOracle.eth(), PMXToken.address, priceFeedETHPMX.address);

    const priceFeedTTXPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_PMX", deployer.address);
    await priceFeedTTXPMX.setDecimals(decimalsPMX);
    ttxPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 ttx=0.2 pmx
    await priceFeedTTXPMX.setAnswer(ttxPriceInPMX);
    await priceOracle.updatePriceFeed(testTokenX.address, PMXToken.address, priceFeedTTXPMX.address);

    tokenWETH = await getContract("Wrapped Ether");
    const priceFeedTTAWETH = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTA_WETH", deployer.address);
    await priceOracle.updatePriceFeed(tokenWETH.address, testTokenA.address, priceFeedTTAWETH.address);
    wethExchangeRate = parseEther("2");
    await priceFeedTTAWETH.setAnswer(wethExchangeRate);
    await priceFeedTTAWETH.setDecimals("18");

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

    protocolRate = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY);
    protocolRateInPmx = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, PMXToken.address);

    limitOrderProtocolRate = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, NATIVE_CURRENCY);
    limitOrderProtocolRateInPmx = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, PMXToken.address);

    borrowedAmount = parseUnits("25", decimalsA);
    depositAmountX = parseUnits("25", decimalsX);
    amountOutMin = 0;
    const lenderAmount = parseUnits("50", decimalsA);

    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    // set prices
    const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
    const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
    const amountBOutWadDecimals = amountBOut.mul(multiplierB);

    const priceAB = wadDiv(borrowedAmountWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
    const exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
    await priceFeed.setAnswer(exchangeABrate);
    await priceFeed.setDecimals(decimalsA);

    const depositAmountXWadDecimals = depositAmountX.mul(multiplierX);
    const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
    const amountBOutDepositWadDecimals = amountBOutDeposit.mul(multiplierB);

    const priceXB = wadDiv(depositAmountXWadDecimals.toString(), amountBOutDepositWadDecimals.toString()).toString();
    const exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
    await priceFeedTTXTTB.setAnswer(exchangeXBrate);
    await priceFeedTTXTTB.setDecimals(decimalsX);

    const amountAOut = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
    const amountAOutWadDecimals = amountAOut.mul(multiplierA);
    const priceXA = wadDiv(depositAmountXWadDecimals.toString(), amountAOutWadDecimals.toString()).toString();
    const exchangeXArate = BigNumber.from(priceXA).div(multiplierX);
    await priceFeedTTXTTA.setAnswer(exchangeXArate);
    await priceFeedTTXTTA.setDecimals(decimalsX);

    positionAmount = amountBOut.add(amountBOutDeposit);

    depositInBorrowedAmount = await primexPricingLibrary.getOracleAmountsOut(
      testTokenX.address,
      testTokenA.address,
      depositAmountX,
      priceOracle.address,
    );
    const leverage = BigNumber.from(WAD).add(wadDiv(amountBOut.toString(), amountBOutDeposit.toString()).toString());
    const positionSize = wadMul(depositAmountX.toString(), leverage.toString()).toString();

    const feeAmountCalculateWithPMXRate = wadMul(positionSize.toString(), protocolRateInPmx.toString()).toString();
    feeAmountInPmx = wadMul(feeAmountCalculateWithPMXRate.toString(), ttxPriceInPMX.toString()).toString();

    const feeAmountCalculateWithETHRate = wadMul(positionSize.toString(), protocolRate.toString()).toString();
    feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  describe("PositionManager", function () {
    describe("openPosition", function () {
      let snapshotId;
      let takeDepositFromWallet, payFeeFromWallet;
      before(async function () {
        takeDepositFromWallet = false;
        payFeeFromWallet = false;

        await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });
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

      it("Should revert open position by order when token (testTokenX) not allowed", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenX.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
      });

      it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const amountOutMin = amountBOut.add(amountBOutDeposit).add(1);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });

      it("Should revert when depositInThirdAssetRoutes sum of shares is 0", async function () {
        const borrowedAmount = parseUnits("25", decimalsA).div(2);
        const depositAmount = parseUnits("25", decimalsX).div(2);

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountBOutDeposit = await getAmountsOut(dex1, depositAmount, [testTokenX.address, testTokenB.address]);
        const amountOutMin = amountBOut.add(amountBOutDeposit);
        const deadline = new Date().getTime() + 600;

        const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
        const amountBOutWadDecimals = amountBOut.mul(multiplierB);
        const priceAB = wadDiv(borrowedAmountWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
        const exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);

        const depositAmountWadDecimals = depositAmount.mul(multiplierX);
        const amountBOutDepositWadDecimals = amountBOutDeposit.mul(multiplierB);
        const priceXB = wadDiv(depositAmountWadDecimals.toString(), amountBOutDepositWadDecimals.toString()).toString();
        const exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: await getSingleRoute([testTokenX.address, testTokenB.address], dex1, 0),
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, false);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, differentPrice);
        await setBadOraclePrice(priceFeed, fivePercent, false, undefined, differentPrice);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        await setBadOraclePrice(priceFeedTTXTTB, fivePercent, false);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenX.address, testTokenB.address, differentPrice);

        await setBadOraclePrice(priceFeedTTXTTB, fivePercent, false, undefined, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Should revert createPosition when isProtocolFeeInPmx=true and trader doesn't have enough protocolFee assets (pmx) on traderBalanceVault", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            isProtocolFeeInPmx: true,
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_FREE_ASSETS");
      });
      it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
        const borrowedAmount = parseUnits("25", decimalsA).div(2);
        const depositAmountX = parseUnits("25", decimalsX).div(2);

        let amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const deadline = new Date().getTime() + 600;

        const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
        let amountBOutWadDecimals = amountBOut.mul(multiplierB);
        let priceAB = wadDiv(borrowedAmountWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
        let exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);

        let amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        let amountBOutDepositWadDecimals = amountBOutDeposit.mul(multiplierB);

        let priceXB = wadDiv(depositAmountX.toString(), amountBOutDepositWadDecimals.toString()).toString();
        let exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);

        let amountOutMin = amountBOut.add(amountBOutDeposit);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });

        amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        amountOutMin = amountBOut.add(amountBOutDeposit);

        amountBOutWadDecimals = amountBOut.mul(multiplierB);
        priceAB = wadDiv(borrowedAmountWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
        exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);

        amountBOutDepositWadDecimals = amountBOutDeposit.mul(multiplierB);

        priceXB = wadDiv(depositAmountX.toString(), amountBOutDepositWadDecimals.toString()).toString();
        exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin.sub(1),
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so add extra depositAmountX in traderBalanceVault
        await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

        await setBadOraclePrice(priceFeedTTXTTA, fivePercent, true);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so add extra depositAmountX in traderBalanceVault
        await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenX.address, differentPrice);

        await setBadOraclePrice(priceFeedTTXTTA, fivePercent, true, undefined, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should create 'Position' and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.changeTokenBalances(testTokenA, [bucket, pair], [borrowedAmount.mul(NegativeOne), borrowedAmount]);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should createPosition when isProtocolFeeInPmx=false", async function () {
        const deadline = new Date().getTime() + 600;
        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
        await expect(() => tx)
          .to.changeTokenBalances(testTokenX, [pairXB, traderBalanceVault], [depositAmountX, depositAmountX.mul(NegativeOne)])
          .to.changeEtherBalances([traderBalanceVault, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);
        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountX);
      });

      it("Should create 'Position' and transfer testTokenX when isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

        const deadline = new Date().getTime() + 600;

        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);

        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          isProtocolFeeInPmx: true,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
        await expect(() => tx)
          .to.changeTokenBalances(testTokenX, [pairXB, traderBalanceVault], [depositAmountX, depositAmountX.mul(NegativeOne)])
          .to.changeTokenBalances(
            PMXToken,
            [traderBalanceVault, Treasury],
            [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
          );

        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountX);
      });
      it("Should create position and increase traders count, and add traderPositions", async function () {
        const deadline = new Date().getTime() + 600;
        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const amountAOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
        const borrowIndex = await bucket.variableBorrowIndex();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position1 = await positionManager.getPosition(0);

        const timestamp = (await provider.getBlock("latest")).timestamp;

        const position = {
          id: 0,
          scaledDebtAmount: scaledDebtAmount,
          bucket: bucket.address,
          depositAsset: testTokenA.address,
          depositAmount: amountAOutDeposit,
          positionAsset: testTokenB.address,
          positionAmount: amountBOut.add(amountBOutDeposit),
          trader: trader.address,
          openBorrowIndex: borrowIndex,
          createdAt: timestamp,
          updatedConditionsAt: timestamp,
          extraParams: "0x",
        };
        parseArguments(position1, position);
      });

      it("Should open position and throw event", async function () {
        const deadline = new Date().getTime() + 600;
        const positionId = 0;
        const amountAOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountAOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);

        const txOpenPosition = await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });

        const numerator = borrowedAmount.add(depositInBorrowedAmount).toString();
        const numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplierA);
        const denominator = amountAOut.add(amountAOutDeposit).toString();
        const denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplierB);

        let entryPrice = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();

        entryPrice = BigNumber.from(entryPrice).div(multiplierA);

        const leverage = wadDiv(amountAOut.add(amountAOutDeposit).toString(), amountAOutDeposit.toString()).toString();
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

      it("Should open position when position size >= minPositionSize", async function () {
        const depositAmountInBorrowed = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const amountInWeth = wadDiv(borrowedAmount.add(depositAmountInBorrowed).toString(), wethExchangeRate.toString()).toString();
        await positionManager.setMinPositionSize(amountInWeth, tokenWETH.address);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.emit(positionManager, "OpenPosition");
      });

      it("Should revert when position size < minPositionSize", async function () {
        const depositAmountInBorrowed = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const numerator = borrowedAmount.add(depositAmountInBorrowed).toString();
        const numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplierA);
        const amountInWeth = wadDiv(numeratorInWadDecimals.toString(), wethExchangeRate.toString()).toString();
        await positionManager.setMinPositionSize(BigNumber.from(amountInWeth).add(1), tokenWETH.address);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
    });

    describe("openPosition with deposit", function () {
      let snapshotId;
      let takeDepositFromWallet, payFeeFromWallet;
      before(async function () {
        takeDepositFromWallet = true;
        payFeeFromWallet = true;
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX);
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

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, false);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: feeAmountInEth },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, differentPrice);

        await setBadOraclePrice(priceFeed, fivePercent, false, undefined, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: feeAmountInEth },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Should revert when deposit Amount insufficient for deal", async function () {
        const depositAmount = parseUnits("1", decimalsX);
        const borrowedAmount = parseUnits("50", decimalsA);
        const deadline = new Date().getTime() + 600;

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const borrowedAmountInWadDecimals = borrowedAmount.mul(multiplierA);
        const amountBOutInWadDecimals = amountBOut.mul(multiplierB);

        const priceAB = wadDiv(borrowedAmountInWadDecimals.toString(), amountBOutInWadDecimals.toString()).toString();
        const exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);

        const amountBOutDeposit = await getAmountsOut(dex1, depositAmount, [testTokenX.address, testTokenB.address]);
        const amountBOutDepositInWadDecimals = amountBOutDeposit.mul(multiplierB);
        const depositAmountInWadDecimals = depositAmount.mul(multiplierX);

        const priceXB = wadDiv(depositAmountInWadDecimals.toString(), amountBOutDepositInWadDecimals.toString()).toString();
        const exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);

        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        expect(availableBalance).to.equal(0);
        expect(lockedBalance).to.equal(0);

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
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
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_DEPOSIT");

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenX.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(0);
      });
      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so approve double depositAmountX on positionManager
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX.mul(2));

        await setBadOraclePrice(priceFeedTTXTTA, fivePercent, true);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: BigNumber.from(feeAmountInEth).mul("2") },
          ),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so approve double depositAmountX on positionManager
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX.mul(2));

        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenX.address, testTokenB.address, differentPrice);

        await setBadOraclePrice(priceFeedTTXTTA, fivePercent, true, undefined, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: BigNumber.from(feeAmountInEth).mul(2) },
          ),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        await setBadOraclePrice(priceFeedTTXTTB, fivePercent, false);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: feeAmountInEth },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenX.address, testTokenB.address, differentPrice);

        await setBadOraclePrice(priceFeedTTXTTB, fivePercent, false, undefined, differentPrice);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: feeAmountInEth },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const amountOutMin = amountBOut.add(amountBOutDeposit).add(1);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              payFeeFromWallet: payFeeFromWallet,
              closeConditions: [],
            },
            { value: feeAmountInEth },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });
      it("Should revert createPosition when isProtocolFeeInPmx=true and trader doesn't have enough protocolFee assets (pmx) on traderBalanceVault", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: depositInThirdAssetRoutes,
              },
              isProtocolFeeInPmx: true,
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: false,
              closeConditions: [],
            },
            { value: feeAmountInEth },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_FREE_ASSETS");
      });

      it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
        const borrowedAmount = parseUnits("25", decimalsA).div(2);
        const depositAmountX = parseUnits("25", decimalsX).div(2);

        let amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
        let amountBOutWadDecimals = amountBOut.mul(multiplierB);
        let priceAB = wadDiv(borrowedAmountWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
        let exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);

        let amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        let amountBOutDepositWadDecimals = amountBOutDeposit.mul(multiplierB);
        let priceXB = wadDiv(depositAmountX.toString(), amountBOutDepositWadDecimals.toString()).toString();
        let exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);

        let amountOutMin = amountBOut.add(amountBOutDeposit);

        const deadline = new Date().getTime() + 600;

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: BigNumber.from(feeAmountInEth).mul(2) },
        );

        amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        amountOutMin = amountBOut.add(amountBOutDeposit);

        amountBOutWadDecimals = amountBOut.mul(multiplierB);
        priceAB = wadDiv(borrowedAmountWadDecimals.toString(), amountBOutWadDecimals.toString()).toString();
        exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);

        amountBOutDepositWadDecimals = amountBOutDeposit.mul(multiplierB);

        priceXB = wadDiv(depositAmountX.toString(), amountBOutDepositWadDecimals.toString()).toString();
        exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
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

      it("Should create 'Position' and transfer testTokenX", async function () {
        const deadline = new Date().getTime() + 600;

        const tx = positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );
        await expect(() => tx)
          .to.changeTokenBalance(testTokenX, trader, depositAmountX.mul(NegativeOne))
          .to.changeEtherBalances([trader, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);
      });

      it("Should createPosition when isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(positionManager.address, feeAmountInPmx);
        // await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

        const deadline = new Date().getTime() + 600;

        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          },
          isProtocolFeeInPmx: true,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
        await expect(() => tx)
          .to.changeTokenBalances(testTokenX, [trader, traderBalanceVault], [depositAmountX.mul(NegativeOne), 0])
          .to.changeTokenBalances(PMXToken, [trader, Treasury], [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx]);
      });
    });

    describe("closePosition", function () {
      let snapshotId;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX);

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        const amountAOut = await getAmountsOut(dex1, positionAmount.toString(), [testTokenB.address, testTokenA.address]);

        const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);

        const price2 = wadDiv(amountAOutInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const limitPrice2 = BigNumber.from(price2).div(multiplierA);
        await priceFeed.setAnswer(limitPrice2);
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

      it("Shouldn't close position and throw revert if called by the NON-owner", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("5", decimalsA).toString(),
          path: [testTokenA.address, testTokenB.address],
        });
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);
        await expect(positionManager.connect(lender).closePosition(0, trader.address, routesForClose, 0)).to.be.reverted;
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, true);

        await expect(positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "DIFFERENT_PRICE_DEX_AND_ORACLE",
        );
      });

      it("Should close position and transfer testTokenB from 'PositionManager' to 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalances(
          testTokenB,
          [positionManager, pair],
          [positionAmount.mul(NegativeOne), positionAmount],
        );
      });
      it("Should close position and transfer testTokenA rest of trader deposit from 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const amountAOut = await getAmountsOut(dex1, positionAmount.toString(), [testTokenB.address, testTokenA.address]);

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          pair,
          amountAOut.mul(NegativeOne),
        );
      });

      it("Should close position and delete trader position from traderPositions list", async function () {
        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        await expect(await positionManager.getTraderPositionsLength(trader.address)).to.be.eq(0);
      });

      it("Should close position and fully repay traders debt", async function () {
        expect(await debtTokenA.balanceOf(trader.address)).to.gt(borrowedAmount);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should close position and fully repay traders debt after 1 block past", async function () {
        await network.provider.send("evm_mine");

        expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should close position and fully repay traders debt after 10 blocks past", async function () {
        for (let i = 0; i < 10; i++) {
          await network.provider.send("evm_mine");
        }

        expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should close position 1 block past and transfer increased full amount (principal + fees) of testTokenA to 'Bucket'", async function () {
        await network.provider.send("evm_mine");

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          bucket,
          positionDebt.toFixed(),
        );
      });

      it("Should close position 1 block past and transfer trader depositAfterDeal from PositionManager to TraderBalanceVault when deal is loss", async function () {
        await network.provider.send("evm_mine");

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const amountAOut = await getAmountsOut(dex1, positionAmount.toString(), [testTokenB.address, testTokenA.address]);

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          traderBalanceVault,
          amountAOut.sub(positionDebt.toString()),
        );

        expect(await testTokenB.balanceOf(positionManager.address)).to.equal(0);
      });

      it("Should close position 1 block past and transfer trader profit from PositionManager to TraderBalanceVault when deal is profit", async function () {
        await network.provider.send("evm_mine");

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("3.5", decimalsA).toString(),
          path: [testTokenA.address, testTokenB.address],
        });

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const amountAOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          traderBalanceVault,
          amountAOut.sub(positionDebt.toString()),
        );

        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        expect(amountAOut.sub(BigNumber.from(positionDebt.toString()))).to.equal(availableBalance);
        expect(0).to.equal(lockedBalance);

        expect(await testTokenA.balanceOf(positionManager.address)).to.equal(0);
        expect(await testTokenB.balanceOf(positionManager.address)).to.equal(0);
      });

      it("Should close position 1 block past and repay to bucket when deal is profit", async function () {
        await network.provider.send("evm_mine");

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("3.5", decimalsA).toString(),
          path: [testTokenA.address, testTokenB.address],
        });

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          bucket,
          positionDebt.toString(),
        );
      });

      it("Should close position 1 block after and add amount to available balance in TraderBalanceVault", async function () {
        await network.provider.send("evm_mine");

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const amountAOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

        const { availableBalance: availableBeforeA } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        const { availableBalance: availableAfterA } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(availableBeforeA).to.equal(0);
        expect(availableAfterA).to.equal(amountAOut.sub(positionDebt.toString()));
      });

      it("Should close position and throw event", async function () {
        await network.provider.send("evm_mine");

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const amountAOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

        const profitInA = amountAOut.sub(positionDebt.toString());

        const tx = await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);
        const expectedClosePosition = {
          positionI: 0,
          trader: trader.address,
          closedBy: trader.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmount,
          profit: profitInA.sub(depositInBorrowedAmount),
          positionDebt: positionDebt,
          amountOut: amountAOut,
          reason: CloseReason.CLOSE_BY_TRADER,
        };

        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition,
          await getContractAt("PositionLibrary", positionManager.address),
        );
      });
    });

    describe("liquidatePosition", function () {
      let snapshotId;
      let depositInBorrowedAmount, amountBOutDeposit;
      let toSwapAmountB;
      before(async function () {
        await positionManager.setDefaultOracleTolerableLimit(parseEther("0.01"));
        await addLiquidity({
          dex: dex1,
          from: "lender",
          tokenA: testTokenA,
          tokenB: testTokenB,
          amountADesired: "100",
          amountBDesired: "100",
          createPool: false,
        });

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;

        depositInBorrowedAmount = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const depositAmountAInWadDecimals = depositInBorrowedAmount.mul(multiplierA);
        const depositAmountXInWadDecimals = depositAmountX.mul(multiplierX);

        const priceXA = wadDiv(depositAmountXInWadDecimals.toString(), depositAmountAInWadDecimals.toString()).toString();
        const exchangeXArate = BigNumber.from(priceXA).div(multiplierX);
        await priceFeedTTXTTA.setAnswer(exchangeXArate);
        await priceFeedTTXTTA.setDecimals(decimalsX);

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const borrowedAmountInWadDecimals = borrowedAmount.mul(multiplierA);
        const amountBOutInWadDecimals = amountBOut.mul(multiplierB);

        const priceAB = wadDiv(borrowedAmountInWadDecimals.toString(), amountBOutInWadDecimals.toString()).toString();
        const exchangeABrate = BigNumber.from(priceAB).div(multiplierA);
        await priceFeed.setAnswer(exchangeABrate);
        await priceFeed.setDecimals(decimalsA);

        amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const amountBOutDepositInWadDecimals = amountBOutDeposit.mul(multiplierB);
        const priceXB = wadDiv(depositAmountXInWadDecimals.toString(), amountBOutDepositInWadDecimals.toString()).toString();
        const exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);
        await priceFeedTTXTTB.setAnswer(exchangeXBrate);
        await priceFeedTTXTTB.setDecimals(decimalsX);
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX);

        const leverage = wadDiv(amountBOut.add(amountBOutDeposit).toString(), amountBOutDeposit.toString());
        const feeAmountCalculateWithETHRate = wadMul(wadMul(depositAmountX.toString(), leverage), protocolRate.toString()).toString();
        feeAmountInEth = wadMul(feeAmountCalculateWithETHRate, PriceInETH.toString()).toString();
        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        if (dex1 === "curve") {
          toSwapAmountB = parseUnits("80", decimalsB);
        } else {
          toSwapAmountB = parseUnits("8", decimalsB);
        }
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
      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("25", decimalsB).toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await setBadOraclePrice(priceFeed, fivePercent, true, dexExchangeRate);

        await expect(
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Shouldn't liquidate position until it not risky", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("5", decimalsA).toString(),
          path: [testTokenA.address, testTokenB.address],
        });
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        await expect(
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.91wad", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const bnWAD = BigNumber.from(WAD.toString());
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        const positionDebt = await positionManager.getPositionDebt(0);
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), dexExchangeRate.mul(multiplierA).toString()).toString();
        amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();

        const securityBuffer = await positionManager.securityBuffer();
        const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

        const numerator = wadMul(
          wadMul(
            wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
            bnWAD.sub(pairPriceDrop).toString(),
          ),
          amount0OutOracle,
        ).toString();

        const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
        const positionState = wadDiv(numerator, denominator).toString();
        expect(await positionManager.healthPosition(0)).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmount]);
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.99wad", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const bnWAD = BigNumber.from(WAD.toString());

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        const positionDebt = await positionManager.getPositionDebt(0);
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), dexExchangeRate.mul(multiplierA).toString()).toString();
        amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();

        const securityBuffer = await positionManager.securityBuffer();
        const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

        const numerator = wadMul(
          wadMul(
            wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
            bnWAD.sub(pairPriceDrop).toString(),
          ),
          amount0OutOracle,
        ).toString();
        const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
        const positionState = wadDiv(numerator, denominator).toString();
        expect(await positionManager.healthPosition(0)).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmount]);
      });

      it("Should liquidate risky position and transfer testTokenA from 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const bnWAD = BigNumber.from(WAD.toString());

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        const positionDebt = await positionManager.getPositionDebt(0);
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), dexExchangeRate.mul(multiplierA).toString()).toString();
        amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();

        const securityBuffer = await positionManager.securityBuffer();
        const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

        const numerator = wadMul(
          wadMul(
            wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
            bnWAD.sub(pairPriceDrop).toString(),
          ),
          amount0OutOracle,
        ).toString();
        const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
        const positionState = wadDiv(numerator, denominator).toString();

        expect(await positionManager.healthPosition(0)).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        const amountAOut = await getAmountsOut(dex1, positionAmount.toString(), [testTokenB.address, testTokenA.address]);
        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalance(testTokenA, pair, amountAOut.mul(NegativeOne));
      });

      it("Should liquidate risky position and delete trader position from traderPositions list", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        await positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });

      it("Should liquidate risky position and fully repay traders debt", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        await positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should liquidate risky position and fully repay traders debt after 3 blocks past", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        for (let i = 0; i < 3; i++) {
          await network.provider.send("evm_mine");
        }

        expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        await positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should liquidate risky position and fully delete trader's deposit from 'TraderBalanceVault'", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        await positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []);
        const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenX.address);

        expect(availableBefore).to.equal(availableAfter).to.equal(0);
      });

      it("Should liquidate risky position and throw event", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        for (let i = 0; i < 3; i++) {
          await network.provider.send("evm_mine");
        }

        const { positionAmount } = await positionManager.getPosition(0);

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );

        const tx = await positionManager
          .connect(liquidator)
          .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []);

        const expectedClosePosition = {
          positionI: 0,
          trader: trader.address,
          closedBy: liquidator.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmount,
          profit: depositInBorrowedAmount.mul(NegativeOne),
          positionDebt: positionDebt,
          amountOut: positionAssetCurrentPrice,
          reason: CloseReason.RISKY_POSITION,
        };

        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition,
          await getContractAt("PositionLibrary", positionManager.address),
        );
      });

      it("Should liquidate risky position and transfer rest of trader deposit to treasury", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const bnWAD = BigNumber.from(WAD.toString());
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        let positionDebt = await positionManager.getPositionDebt(0);
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), dexExchangeRate.mul(multiplierA).toString()).toString();
        amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();
        const securityBuffer = await positionManager.securityBuffer();
        const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

        const numerator = wadMul(
          wadMul(
            wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
            bnWAD.sub(pairPriceDrop).toString(),
          ),
          amount0OutOracle,
        ).toString();
        const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
        const positionState = wadDiv(numerator, denominator).toString();

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );

        const returnedToTrader = positionAssetCurrentPrice.sub(positionDebt.toString());

        expect(await positionManager.healthPosition(0)).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalance(testTokenA, Treasury, returnedToTrader);
        const { availableBalance: availableLiquidator } = await traderBalanceVault.balances(liquidator.address, testTokenA.address);
        const { availableBalance: availableTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        expect(availableTrader).to.equal(0);
        expect(availableLiquidator).to.equal(0);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should liquidate risky position 1 block past and transfer positionDebt (principal + fees) of testTokenA to 'Bucket'", async function () {
        await network.provider.send("evm_mine");

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });
        const { positionAmount } = await positionManager.getPosition(0);
        const amount0Out = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = amount0Out.mul(multiplierA);
        const rate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toFixed());
      });
    });

    describe("increaseDeposit", function () {
      let positionId, depositAmount, dex, assetRoutes, depositIncreaseX;

      // eslint-disable-next-line mocha/no-hooks-for-single-case
      before(async function () {
        await testTokenA.mint(trader.address, parseUnits("100", decimalsA));

        const lenderAmount = parseUnits("1000", decimalsA);
        depositAmount = parseUnits("15", decimalsA);

        await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);

        await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

        await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

        const borrowedAmount = parseUnits("25", decimalsA);
        const amountOutMin = 0;
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const payFeeFromWallet = false;

        dex = "uniswap";

        const swapSize = depositAmount.add(borrowedAmount);
        const swap = swapSize.mul(multiplierA);
        const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
        const amountB = amount0Out.mul(multiplierB);
        const price = wadDiv(swap.toString(), amountB.toString()).toString();
        const limitPrice = BigNumber.from(price).div(multiplierA);
        await priceFeed.setAnswer(limitPrice);
        await priceFeed.setDecimals(decimalsA);

        await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
        const feeAmountCalculateWithETHRate = wadMul(swapSize.mul(multiplierA).toString(), protocolRate.toString()).toString();
        feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

        await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);
        await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

        positionId = await positionManager.positionsId();

        assetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

        await positionManager.connect(trader).openPosition({
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
        });
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

      it("Should set amountOut from dex even if oracle amountOut is less than dex amount out", async function () {
        depositIncreaseX = parseUnits("1", decimalsX);

        const depositAmountA = await getAmountsOut(dex, depositIncreaseX, [testTokenX.address, testTokenA.address]);

        const depositIncreaseXInWadDecimals = depositIncreaseX.mul(multiplierX);
        const depositAmountAInWadDecimals = depositAmountA.mul(multiplierA);
        const priceXA = wadDiv(depositIncreaseXInWadDecimals.toString(), depositAmountAInWadDecimals.toString()).toString();
        const exchangeXArate = BigNumber.from(priceXA).div(multiplierX);
        await priceFeedTTXTTA.setAnswer(exchangeXArate.add(parseUnits("2", decimalsX)));
        await priceFeedTTXTTA.setDecimals(decimalsX);

        const positionBeforeIncrease = await positionManager.getPosition(positionId);
        const depositBeforeIncrease = positionBeforeIncrease.depositAmountInSoldAsset;

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.be.equal(1);

        // increase deposit
        await testTokenX.connect(trader).approve(positionManager.address, depositIncreaseX);
        await positionManager
          .connect(trader)
          .increaseDeposit(
            positionId,
            depositIncreaseX,
            testTokenX.address,
            true,
            await getSingleRoute([testTokenX.address, testTokenA.address], dex),
            0,
          );
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.be.equal(1);

        // get position after increaseDeposit
        const positionAfterIncrease = await positionManager.getPosition(positionId);
        const depositAmountAfterIncrease = positionAfterIncrease.depositAmountInSoldAsset;

        expect(depositAmountAfterIncrease.sub(depositBeforeIncrease)).to.equal(depositAmountA);
      });
    });
  });

  describe("LimitOrderManager", function () {
    describe("openPositionByOrder", function () {
      let snapshotId,
        depositAmountX,
        leverage,
        orderId,
        orderWithFeeInPmxId,
        slPrice,
        tpPrice,
        exchangeABrate,
        exchangeXArate,
        defaultAdditionalParams,
        feeAmountInPmx;
      before(async function () {
        leverage = parseEther("2.5");
        depositAmountX = parseUnits("5", decimalsX);

        const positionSize = wadMul(depositAmountX.toString(), leverage.toString()).toString();
        const feeAmountCalculateWithPMXRate = wadMul(positionSize.toString(), limitOrderProtocolRateInPmx.toString()).toString();
        feeAmountInPmx = wadMul(feeAmountCalculateWithPMXRate.toString(), ttxPriceInPMX.toString()).toString();

        const feeAmountCalculateWithETHRate = wadMul(positionSize.toString(), limitOrderProtocolRate.toString()).toString();
        feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

        await testTokenX.connect(trader).approve(limitOrderManager.address, depositAmountX.add(depositAmountX));

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;

        const depositAmountAFromDex = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const depositAmountXInWadDecimals = depositAmountX.mul(multiplierX);
        const depositAmountAInWadDecimals = depositAmountAFromDex.mul(multiplierA);

        const priceXA = wadDiv(depositAmountXInWadDecimals.toString(), depositAmountAInWadDecimals.toString()).toString();
        exchangeXArate = BigNumber.from(priceXA).div(multiplierX);

        await priceFeedTTXTTA.setAnswer(exchangeXArate);
        await priceFeedTTXTTA.setDecimals(decimalsX);

        const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const amountBOutDepositInWadDecimals = amountBOutDeposit.mul(multiplierB);
        const priceXB = wadDiv(depositAmountXInWadDecimals.toString(), amountBOutDepositInWadDecimals.toString()).toString();
        const exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);

        await priceFeedTTXTTB.setAnswer(exchangeXBrate);
        await priceFeedTTXTTB.setDecimals(decimalsX);

        const toSwapAmountA = wadMul(depositAmountAFromDex.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const borrowAmountInB = await getAmountsOut(dex1, toSwapAmountA, [testTokenA.address, testTokenB.address]);
        const toSwapAmountAInWadDecimals = BigNumber.from(toSwapAmountA).mul(multiplierA);
        const borrowAmountInBInWadDecimals = borrowAmountInB.mul(multiplierB);
        const priceAB = BigNumber.from(wadDiv(toSwapAmountAInWadDecimals.toString(), borrowAmountInBInWadDecimals.toString()).toString());
        exchangeABrate = priceAB.div(multiplierA);

        await priceFeed.setAnswer(exchangeABrate);
        await priceFeed.setDecimals(decimalsA);

        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          exchangeABrate,
          leverage,
        );

        slPrice = liquidationPrice.add(1).mul(multiplierA);
        tpPrice = exchangeABrate.add(1).mul(multiplierA);

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
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeABrate))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          },
          { value: feeAmountInEth },
        );

        orderId = await limitOrderManager.ordersId();
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmx);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeABrate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
        });

        orderWithFeeInPmxId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, depositInThirdAssetRoutes);
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
      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, false);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenA.address, testTokenB.address, differentPrice);

        await setBadOraclePrice(priceFeed, fivePercent, false, undefined, differentPrice);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should revert when firstAssetRoutes summ of shares is 0", async function () {
        const additionalParams = getLimitPriceAdditionalParams(
          [[BigNumber.from(0), [[dex1, await getEncodedPath([testTokenA.address, testTokenB.address], dex1)]]]],
          depositInThirdAssetRoutes,
        );

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: additionalParams,
            firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex1, 0),
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should revert when depositInThirdAssetRoutes summ of shares is 0", async function () {
        const additionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [
          [BigNumber.from(0), [[dex1, await getEncodedPath([testTokenX.address, testTokenB.address], dex1)]]],
        ]);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: additionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: await getSingleRoute([testTokenX.address, testTokenB.address], dex1, 0),
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        await setBadOraclePrice(priceFeedTTXTTB, fivePercent, false);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenX.address, testTokenB.address, differentPrice);
        await setBadOraclePrice(priceFeedTTXTTB, fivePercent, false, undefined, differentPrice);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        await setBadOraclePrice(priceFeedTTXTTA, fivePercent, true);

        const depositAmountA = wadDiv(depositAmountX.toString(), (await priceFeedTTXTTA.latestAnswer()).toString()).toString();
        const depositAmountAInADecimals = BigNumber.from(depositAmountA).div(multiplierA);
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalance(
          testTokenA,
          bucket,
          wadMul(depositAmountAInADecimals.toString(), leverage.sub(parseEther("1")).toString())
            .multipliedBy(NegativeOne.toString())
            .toString(),
        );
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        await positionManager.connect(deployer).setOracleTolerableLimit(testTokenX.address, testTokenB.address, differentPrice);
        await setBadOraclePrice(priceFeedTTXTTA, fivePercent, true, undefined, differentPrice);

        const depositAmountA = wadDiv(depositAmountX.toString(), (await priceFeedTTXTTA.latestAnswer()).toString()).toString();
        const depositAmountAInADecimals = BigNumber.from(depositAmountA).div(multiplierA);
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalance(
          testTokenA,
          bucket,
          wadMul(depositAmountAInADecimals.toString(), leverage.sub(parseEther("1")).toString())
            .multipliedBy(NegativeOne.toString())
            .toString(),
        );
      });

      it("Should create position by order when stopLoss=0, takeProfit=0", async function () {
        await testTokenX.connect(trader).approve(limitOrderManager.address, depositAmountX);

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;
        const slPrice = 0;
        const tpPrice = 0;
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
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeABrate))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          },
          { value: feeAmountInEth },
        );
        const orderId = await limitOrderManager.ordersId();

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          keeper: liquidator.address,
        });
      });

      it("Should create position by order and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
        const depositAmountA = await primexPricingLibrary.getOracleAmountsOut(
          testTokenX.address,
          testTokenA.address,
          depositAmountX,
          priceOracle.address,
        );
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalances(
          testTokenA,
          [bucket],
          [
            wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString())
              .multipliedBy(NegativeOne.toString())
              .toString(),
          ],
        );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order when dex amountOut < oracle amountOut, increase traders count, add traderPositions and then delete the order", async function () {
        const depositAmountA = await primexPricingLibrary.getOracleAmountsOut(
          testTokenX.address,
          testTokenA.address,
          depositAmountX,
          priceOracle.address,
        );
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const depositAmountInBDecimals = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const positionAmount = amount0Out.add(depositAmountInBDecimals);

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          keeper: liquidator.address,
        });
        const borrowIndex = await bucket.variableBorrowIndex();
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.be.equal(1);
        const position = await positionManager.getPosition(0);
        const borrowedAmount = wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositAmountA);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(positionAmount);
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should create position by order when dex amountOut > oracle amountOut, increase traders count, add traderPositions and then delete the order", async function () {
        // making the oracle price worse than the dex price
        const newPrice = wadDiv(exchangeXArate.toString(), BigNumber.from(WAD).sub(parseEther("0.05")).toString()).toString();
        await priceFeedTTXTTA.setAnswer(newPrice);
        let amountOutFromOracle = wadDiv(depositAmountX.mul(multiplierX).toString(), newPrice.toString());
        amountOutFromOracle = BigNumber.from(amountOutFromOracle.toString()).div(multiplierA);
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(amountOutFromOracle.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const depositAmountInBDecimals = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const positionAmount = amount0Out.add(depositAmountInBDecimals);

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          keeper: liquidator.address,
        });
        const borrowIndex = await bucket.variableBorrowIndex();
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position = await positionManager.getPosition(0);
        const borrowedAmount = wadMul(amountOutFromOracle.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(amountOutFromOracle);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(positionAmount);
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should open position by order and do not lock trader deposit amount from dex in traderBalanceVault", async function () {
        const { lockedBalance: lockedBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const { lockedBalance: lockedBalanceTraderAbefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.changeEtherBalances([traderBalanceVault, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);

        const { lockedBalance: lockedBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const { lockedBalance: lockedBalanceTraderAafter } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        expect(lockedBalanceTraderBbefore.sub(lockedBalanceTraderBafter)).to.equal(depositAmountX);
        expect(lockedBalanceTraderAafter.sub(lockedBalanceTraderAbefore)).to.equal(0);
      });

      it("Should open position when isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

        const { lockedBalance: lockedBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const traderReserveBalancesBefore = await traderBalanceVault.balances(trader.address, PMXToken.address);

        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderWithFeeInPmxId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: depositInThirdAssetRoutes,
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalances(
          PMXToken,
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
        );

        const { lockedBalance: lockedBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);

        expect(lockedBalanceTraderBbefore.sub(lockedBalanceTraderBafter)).to.equal(depositAmountX);

        const traderReserveBalancesAfter = await traderBalanceVault.balances(trader.address, PMXToken.address);
        expect(traderReserveBalancesBefore.lockedBalance.sub(traderReserveBalancesAfter.lockedBalance)).to.equal(feeAmountInPmx);
      });

      it("Should open position by order and do not lock trader deposit amount traderBalanceVault", async function () {
        const { lockedBalance: lockedBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          keeper: liquidator.address,
        });
        const { lockedBalance: lockedAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(lockedBefore).to.equal(lockedAfter);
      });
    });
    describe("canBeFilled", function () {
      let snapshotId, leverage, depositAmountA, slPrice, tpPrice, limitPrice, params, defaultAdditionalParams, conditionIndex;
      let orderId1, orderId2, orderId3;
      before(async function () {
        conditionIndex = 0;
        leverage = parseEther("2.5");
        const positionSize = wadMul(depositAmountX.toString(), leverage.toString()).toString();
        const feeAmountCalculateWithPMXRate = wadMul(positionSize.toString(), limitOrderProtocolRateInPmx.toString()).toString();
        feeAmountInPmx = wadMul(feeAmountCalculateWithPMXRate.toString(), ttxPriceInPMX.toString()).toString();
        const feeAmountCalculateWithETHRate = wadMul(positionSize.toString(), limitOrderProtocolRate.toString()).toString();
        feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

        await testTokenX.connect(trader).approve(limitOrderManager.address, depositAmountX.mul(2).add(depositAmountX));

        await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: BigNumber.from(feeAmountInEth).mul(3) });

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;

        depositAmountA = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const depositAmountXInWadDecimals = depositAmountX.mul(multiplierX);
        const depositAmountAInWadDecimals = depositAmountA.mul(multiplierA);
        const priceXA = wadDiv(depositAmountXInWadDecimals.toString(), depositAmountAInWadDecimals.toString()).toString();
        const exchangeXArate = BigNumber.from(priceXA).div(multiplierX);

        await priceFeedTTXTTA.setAnswer(exchangeXArate);
        await priceFeedTTXTTA.setDecimals(decimalsX);

        const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const amountBOutDepositInWadDecimals = amountBOutDeposit.mul(multiplierB);
        const priceXB = wadDiv(depositAmountXInWadDecimals.toString(), amountBOutDepositInWadDecimals.toString()).toString();
        const exchangeXBrate = BigNumber.from(priceXB).div(multiplierX);

        await priceFeedTTXTTB.setAnswer(exchangeXBrate);
        await priceFeedTTXTTB.setDecimals(decimalsX);

        const amountIn = wadMul(depositAmountA.toString(), leverage.toString()).toString();

        const amountToTransfer = BigNumber.from(amountIn).sub(depositAmountA);
        const borrowAmountInB = await getAmountsOut(dex1, amountToTransfer, [testTokenA.address, testTokenB.address]);
        const borrowAmountInWadDecimals = borrowAmountInB.mul(multiplierB);

        const denominatorInWadDecimals = borrowAmountInB.add(amountBOutDeposit).mul(multiplierB);
        const amountInInWad = BigNumber.from(amountIn).mul(multiplierA);

        limitPrice = BigNumber.from(wadDiv(amountInInWad.toString(), denominatorInWadDecimals.toString()).toString());
        limitPrice = limitPrice.div(multiplierA);

        const rate = BigNumber.from(wadDiv(amountInInWad.toString(), borrowAmountInWadDecimals.toString()).toString());
        const exchangeRate = rate.div(multiplierA);
        await priceFeed.setAnswer(exchangeRate);
        await priceFeed.setDecimals(decimalsA);

        slPrice = 0;
        tpPrice = limitPrice.add(3).mul(multiplierA);
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
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          },
          { value: feeAmountInEth },
        );
        orderId1 = await limitOrderManager.ordersId();

        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmx);
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.add(1)))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
        });
        orderId2 = await limitOrderManager.ordersId();

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
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.sub(2)))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          },
          { value: feeAmountInEth },
        );
        orderId3 = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, depositInThirdAssetRoutes);
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
        params = {
          orderId: orderId1,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: depositInThirdAssetRoutes,
          keeper: liquidator.address,
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
      it("Should revert when depositAsset is third asset and firstAssetRoutes length is empty", async function () {
        const additionalParams = getLimitPriceAdditionalParams([], depositInThirdAssetRoutes);
        await expect(
          limitOrderManager.connect(liquidator).canBeFilled(orderId1, conditionIndex, additionalParams),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
        params.firstAssetRoutes = [];
        params.comAdditionalParams = additionalParams;
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
        );
      });
      it("Should revert when depositAsset is third asset and depositInThirdAssetRoutes length is empty", async function () {
        const additionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, []);
        await expect(
          limitOrderManager.connect(liquidator).canBeFilled(orderId1, conditionIndex, additionalParams),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
        params.depositInThirdAssetRoutes = [];
        params.comAdditionalParams = additionalParams;
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
        );
      });

      it("Should return true when limitPrice is more than current price on dex and trader has enough pmx on traderBalanceVault", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);
        expect(await limitOrderManager.callStatic.canBeFilled(orderId2, conditionIndex, defaultAdditionalParams)).to.be.equal(true);
        params.orderId = orderId2;
        await limitOrderManager.connect(liquidator).openPositionByOrder(params);
      });
      it("Should return true when limitPrice is current price on dex ", async function () {
        expect(await limitOrderManager.callStatic.canBeFilled(orderId1, conditionIndex, defaultAdditionalParams)).to.be.equal(true);
        await limitOrderManager.connect(liquidator).openPositionByOrder(params);
      });
      it("Should return false when limitPrice is less than current price on dex ", async function () {
        expect(await limitOrderManager.callStatic.canBeFilled(orderId3, conditionIndex, defaultAdditionalParams)).to.be.equal(false);

        params.orderId = orderId3;
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_CAN_NOT_BE_FILLED",
        );
      });
      it("Should return false when limitPrice > current price(10) but deadline < block.timestamp", async function () {
        await network.provider.send("evm_setNextBlockTimestamp", [new Date().getTime() + 800]);
        await network.provider.send("evm_mine");
        expect(await limitOrderManager.callStatic.canBeFilled(orderId1, conditionIndex, defaultAdditionalParams)).to.be.equal(false);
        await expect(limitOrderManager.connect(liquidator).callStatic.openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORDER_HAS_EXPIRED",
        );
      });
    });
  });
});
