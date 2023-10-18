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
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  WAD,
  OrderType,
  MAX_TOKEN_DECIMALITY,
  CloseReason,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  NATIVE_CURRENCY,
} = require("./utils/constants");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { increaseBlocksBy } = require("./utils/hardhatUtils");
const { setBadOraclePrice, fivePercent } = require("./utils/setBadOraclePrice");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("./utils/conditionParams");
const { getAmountsOut, addLiquidity, swapExactTokensForTokens, getPair, getEncodedPath, getSingleRoute } = require("./utils/dexOperations");
const { eventValidation } = require("./utils/eventValidation");

process.env.TEST = true;

describe("DepositAsset_isPositionAsset", function () {
  let priceFeed,
    priceFeedTTXTTB,
    priceFeedTTXTTA,
    dex1,
    dex2,
    positionManager,
    limitOrderManager,
    traderBalanceVault,
    Treasury,
    PMXToken,
    testTokenA,
    testTokenB,
    tokenWETH,
    bucket,
    primexPricingLibrary,
    primexPricingLibraryMock,
    firstAssetRoutes,
    routesForClose,
    firstAssetRoutesOnDex1and2,
    wethExchangeRate,
    decimalsA,
    decimalsB,
    decimalsX,
    priceOracle;
  let deployer, trader, lender, liquidator, pair, debtTokenA, testTokenX, snapshotIdBase, PrimexDNS, bucketAddress, ErrorsLibrary;
  let multiplierA, multiplierB;
  let increaseBy;
  let protocolRate,
    limitOrderProtocolRate,
    limitOrderProtocolRateInPmx,
    protocolRateInPmx,
    ttbPriceInPMX,
    depositAmountB,
    borrowedAmount,
    amountOutMin,
    positionAmount,
    depositInBorrowedAmount,
    feeAmountInEth,
    feeAmountInPmx,
    PriceInETH;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender, liquidator } = await getNamedSigners());
    PrimexDNS = await getContract("PrimexDNS");
    positionManager = await getContract("PositionManager");
    limitOrderManager = await getContract("LimitOrderManager");
    traderBalanceVault = await getContract("TraderBalanceVault");
    PMXToken = await getContract("EPMXToken");
    ErrorsLibrary = await getContract("Errors");
    Treasury = await getContract("Treasury");

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
    await testTokenX.mint(lender.address, parseUnits("100", decimalsX));
    await testTokenX.mint(trader.address, parseUnits("100", decimalsX));

    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex1);
    routesForClose = await getSingleRoute([testTokenB.address, testTokenA.address], dex1);
    firstAssetRoutesOnDex1and2 = firstAssetRoutes.concat(await getSingleRoute([testTokenA.address, testTokenB.address], dex2));

    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenB, amountADesired: "100", amountBDesired: "100" });
    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenX, amountADesired: "100", amountBDesired: "100" });
    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenB, tokenB: testTokenX, amountADesired: "100", amountBDesired: "100" });

    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB, amountADesired: "85", amountBDesired: "100" });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenX, amountADesired: "85", amountBDesired: "100" });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenB, tokenB: testTokenX, amountADesired: "85", amountBDesired: "100" });

    const pairAddress = await getPair(dex1, testTokenA.address, testTokenB.address);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");

    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);

    const tokenUSD = await getContract("USD Coin");
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    priceFeedTTXTTB = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTB", deployer.address);
    priceFeedTTXTTA = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTA", deployer.address);
    const priceFeedTTBETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_ETH", deployer.address);
    const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTB_USD", deployer.address);
    await priceFeedTTBUSD.setAnswer(parseUnits("1", "8"));
    await priceFeedTTBUSD.setDecimals("8");

    PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTBETH.setDecimals("18");
    await priceFeedTTBETH.setAnswer(PriceInETH);

    await priceOracle.updatePriceFeed(testTokenB.address, await priceOracle.eth(), priceFeedTTBETH.address);
    await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTBETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenX.address, priceFeedTTXTTB.address);
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenX.address, priceFeedTTXTTA.address);
    await priceOracle.updatePriceFeed(testTokenB.address, tokenUSD.address, priceFeedTTBUSD.address);

    const priceFeedTTBPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_PMX", deployer.address);
    const decimalsPMX = await PMXToken.decimals();
    await priceFeedTTBPMX.setDecimals(decimalsPMX);
    ttbPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 ttb=0.2 pmx
    await priceFeedTTBPMX.setAnswer(ttbPriceInPMX);
    await priceOracle.updatePriceFeed(testTokenB.address, PMXToken.address, priceFeedTTBPMX.address);

    tokenWETH = await getContract("Wrapped Ether");
    const priceFeedTTAWETH = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTA_WETH", deployer.address);
    await priceOracle.updatePriceFeed(tokenWETH.address, testTokenA.address, priceFeedTTAWETH.address);
    wethExchangeRate = parseEther("2");
    await priceFeedTTAWETH.setAnswer(wethExchangeRate);
    await priceFeedTTAWETH.setDecimals("18");

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    protocolRate = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY);
    protocolRateInPmx = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, PMXToken.address);

    limitOrderProtocolRate = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, NATIVE_CURRENCY);
    limitOrderProtocolRateInPmx = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, PMXToken.address);

    depositAmountB = parseUnits("1", decimalsB);
    borrowedAmount = parseUnits("2", decimalsA);
    amountOutMin = 0;
    const lenderAmount = parseUnits("1000", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender).deposit(lender.address, lenderAmount);

    const amount0Out = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
    const amount0OutInWadDecimals = amount0Out.mul(multiplierB);
    const borrowedAmountInWadDecimals = borrowedAmount.mul(multiplierA);
    const price = wadDiv(borrowedAmountInWadDecimals.toString(), amount0OutInWadDecimals.toString()).toString();
    const limitPrice = BigNumber.from(price).div(multiplierA);
    await priceFeed.setAnswer(limitPrice);
    await priceFeed.setDecimals(decimalsA);

    positionAmount = depositAmountB.add(amount0Out);

    depositInBorrowedAmount = await primexPricingLibrary.getOracleAmountsOut(
      testTokenB.address,
      testTokenA.address,
      depositAmountB,
      priceOracle.address,
    );
    const leverage = BigNumber.from(WAD).add(wadDiv(amount0Out.toString(), depositAmountB.toString()).toString());
    const positionSize = wadMul(depositAmountB.toString(), leverage.toString()).toString();

    const feeAmountCalculateWithPMXRate = wadMul(positionSize.toString(), protocolRateInPmx.toString()).toString();
    feeAmountInPmx = wadMul(BigNumber.from(feeAmountCalculateWithPMXRate).mul(multiplierB).toString(), ttbPriceInPMX.toString()).toString();

    const feeAmountCalculateWithETHRate = wadMul(positionSize.toString(), protocolRate.toString()).toString();
    feeAmountInEth = wadMul(BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierB).toString(), PriceInETH.toString()).toString();
    increaseBy = 2628000; // calculated for a year from average 7200 blocks per day on Ethereum
    await positionManager.setMaintenanceBuffer(parseEther("0.01"));

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
        await testTokenB.connect(trader).approve(traderBalanceVault.address, depositAmountB);
        await traderBalanceVault.connect(trader).deposit(testTokenB.address, depositAmountB);
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
      it("Should revert open position when not allowed token (testTokenX)", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenX.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
      });
      it("Should revert when firstAssetRoutes is empty list", async function () {
        const borrowedAmountInternal = borrowedAmount.div(2);
        const depositAmountInternal = depositAmountB.div(2);
        const amount0Out = (await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address])).add(depositAmountB);

        const amountOutMin = amount0Out;
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const payFeeFromWallet = false;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmountInternal,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: [],
            depositAsset: testTokenB.address,
            depositAmount: depositAmountInternal,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
        const amount0Out = (await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address])).add(depositAmountB);

        const amountOutMin = amount0Out.add(1);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });

      it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
        const borrowedAmountInternal = borrowedAmount.div(4);
        const depositAmountInternal = depositAmountB.div(4);
        let amount0Out = await getAmountsOut(dex1, borrowedAmountInternal, [testTokenA.address, testTokenB.address]);
        const borrowedAmountInternalInWadDecimals = borrowedAmountInternal.mul(multiplierA);
        let amount0OutInWadDecimals = amount0Out.mul(multiplierB);

        let price = wadDiv(borrowedAmountInternalInWadDecimals.toString(), amount0OutInWadDecimals.toString()).toString();
        let limitPrice = BigNumber.from(price).div(multiplierA);
        await priceFeed.setAnswer(limitPrice);

        let amountOutMin = amount0Out.add(depositAmountInternal);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const payFeeFromWallet = false;

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmountInternal,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountInternal,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });

        amount0Out = await getAmountsOut(dex1, borrowedAmountInternal, [testTokenA.address, testTokenB.address]);
        amount0OutInWadDecimals = amount0Out.mul(multiplierB);
        amountOutMin = amount0Out.add(depositAmountInternal);
        price = wadDiv(borrowedAmountInternalInWadDecimals.toString(), amount0OutInWadDecimals.toString()).toString();
        limitPrice = BigNumber.from(price).div(multiplierA);
        await priceFeed.setAnswer(limitPrice);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmountInternal,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountInternal,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin.sub(1),
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
      });

      it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, false);

        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should create 'Position' and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
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

      it("Should create 'Position' and transfer testTokenB from traderBalanceVault to positionManager", async function () {
        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);
        const deadline = new Date().getTime() + 600;
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
        await expect(() => tx)
          .to.changeTokenBalances(testTokenB, [positionManager, traderBalanceVault], [positionAmount, depositAmountB.mul(NegativeOne)])
          .to.changeEtherBalances([traderBalanceVault, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);

        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenB.address);
        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountB);
      });

      it("Should create 'Position' with isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);
        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);

        const traderReserveBalancesBefore = await traderBalanceVault.balances(trader.address, PMXToken.address);

        const deadline = new Date().getTime() + 600;
        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            isProtocolFeeInPmx: true,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          }),
        ).to.changeTokenBalances(testTokenB, [positionManager, traderBalanceVault], [positionAmount, depositAmountB.mul(NegativeOne)]);

        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenB.address);

        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountB);
        const traderReserveBalancesAfter = await traderBalanceVault.balances(trader.address, PMXToken.address);
        expect(traderReserveBalancesBefore.availableBalance.sub(traderReserveBalancesAfter.availableBalance)).to.equal(feeAmountInPmx);
      });

      it("Should create position and increase traders count, and add traderPositions", async function () {
        const deadline = new Date().getTime() + 600;

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
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

        const position = await positionManager.getPosition(0);
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositInBorrowedAmount);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amountBOut.add(depositAmountB));
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
      });

      it("Should open position and throw event", async function () {
        const deadline = new Date().getTime() + 600;
        const positionId = 0;
        const amountAOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);

        const txOpenPosition = await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });

        const numerator = borrowedAmount.add(depositInBorrowedAmount).toString();
        const numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplierA);
        const denominator = amountAOut.add(depositAmountB).toString();
        const denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplierB);

        let entryPrice = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();
        entryPrice = BigNumber.from(entryPrice).div(multiplierA);

        const leverage = wadDiv(amountAOut.add(depositAmountB).toString(), depositAmountB.toString()).toString();
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

      it("Should open position on multiple dexes", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        const payFeeFromWallet = false;

        const amountBOut = (await getAmountsOut(dex1, borrowedAmount.div(2), [testTokenA.address, testTokenB.address])).add(
          await getAmountsOut(dex2, borrowedAmount.div(2), [testTokenA.address, testTokenB.address]),
        );
        const amountAOut = await primexPricingLibrary.getOracleAmountsOut(
          testTokenB.address,
          testTokenA.address,
          depositAmountB,
          priceOracle.address,
        );
        await testTokenB.connect(trader).approve(traderBalanceVault.address, depositAmountB);
        await traderBalanceVault.connect(trader).deposit(testTokenB.address, depositAmountB);
        await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutesOnDex1and2,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
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
        const position = await positionManager.getPosition(0);
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(amountAOut);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amountBOut.add(depositAmountB));
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
      });

      it("Should open position when position size >= minPositionSize", async function () {
        const positionAmount = borrowedAmount.add(depositInBorrowedAmount);
        const amountInWeth = wadDiv(positionAmount.toString(), wethExchangeRate.toString()).toString();
        await positionManager.setMinPositionSize(amountInWeth, tokenWETH.address);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
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
        const positionAmountInBorrowed = borrowedAmount.add(depositInBorrowedAmount);
        const positionAmountInPositionAssetDecimals = positionAmountInBorrowed.mul(multiplierA).div(multiplierB);
        await positionManager.setMinPositionSize(positionAmountInPositionAssetDecimals.add(1), testTokenB.address);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
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
        await testTokenB.connect(trader).approve(positionManager.address, MaxUint256);
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

      it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
        const amount0Out = (await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address])).add(depositAmountB);
        const amountOutMin = amount0Out.add(1);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: [],
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenB.address,
              depositAmount: depositAmountB,
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

      it("Should revert when deposit Amount on dex insufficient for deal", async function () {
        const depositAmountB = parseUnits("1", decimalsB);
        const borrowedAmount = parseUnits("10", decimalsA);

        const amount0Out = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const numerator = borrowedAmount.mul(multiplierA);
        const denominator = amount0Out.mul(multiplierB);

        const limitPrice = BigNumber.from(wadDiv(numerator.toString(), denominator.toString()).toString()).div(multiplierA);
        await priceFeed.setAnswer(limitPrice);

        const deadline = new Date().getTime() + 600;

        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenB.address);
        expect(availableBalance).to.equal(0);
        expect(lockedBalance).to.equal(0);

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: [],
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenB.address,
              depositAmount: depositAmountB,
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
          testTokenB.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(0);
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, false);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: [],
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenB.address,
              depositAmount: depositAmountB,
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
      it("Should revert openPosition with isProtocolFeeInPmx=true and takeDepositFromWallet = false if trader doesn't have enough pmx in traderBalanceVault", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetRoutes: [],
              },
              firstAssetRoutes: firstAssetRoutes,
              depositAsset: testTokenB.address,
              depositAmount: depositAmountB,
              isProtocolFeeInPmx: true,
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
        const halfBorrowedAmount = borrowedAmount.div(2);
        const halfDepositAmountB = depositAmountB.div(2);

        let amount0Out = await getAmountsOut(dex1, halfBorrowedAmount, [testTokenA.address, testTokenB.address]);
        let amountOutMin = amount0Out.add(halfDepositAmountB);
        const deadline = new Date().getTime() + 600;

        let limitPrice = wadDiv(halfBorrowedAmount.toString(), amount0Out.toString()).toString();
        await priceFeed.setAnswer(limitPrice);

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: halfBorrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: halfDepositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        amount0Out = await getAmountsOut(dex1, halfBorrowedAmount, [testTokenA.address, testTokenB.address]);
        amountOutMin = amount0Out.add(halfDepositAmountB);

        limitPrice = wadDiv(halfBorrowedAmount.toString(), amount0Out.toString()).toString();
        await priceFeed.setAnswer(limitPrice);

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: halfBorrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: halfDepositAmountB,
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

      it("Should not lock tokens in traderBalanceVault as a collateral for deal", async function () {
        const deadline = new Date().getTime() + 600;
        const { lockedBalance: lockedBalanceTraderAbefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        const tx = positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
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
          .to.changeTokenBalance(testTokenB, trader, depositAmountB.mul(NegativeOne))
          .to.changeEtherBalances([trader, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);

        const { lockedBalance: lockedBalanceTraderAafter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(lockedBalanceTraderAafter.sub(lockedBalanceTraderAbefore)).to.equal(0);
      });
      it("Should create 'Position' with isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(positionManager.address, feeAmountInPmx);

        const deadline = new Date().getTime() + 600;
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          isProtocolFeeInPmx: true,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          closeConditions: [],
        });
        await expect(() => tx)
          .to.changeTokenBalances(
            testTokenB,
            [trader, positionManager, traderBalanceVault],
            [depositAmountB.mul(NegativeOne), positionAmount, 0],
          )
          .to.changeTokenBalances(PMXToken, [trader, Treasury], [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx]);
      });
    });

    describe("closePosition", function () {
      let snapshotId;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;
        await testTokenB.connect(trader).approve(positionManager.address, depositAmountB);

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            closeConditions: [],
          },
          { value: feeAmountInEth },
        );

        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const amountAOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
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

      it("Should close position and transfer testTokenA from 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);

        const amountAOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          pair,
          amountAOut.mul(NegativeOne),
        );
      });

      it("Should close position and delete trader position from traderPositions list", async function () {
        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });

      it("Should close position and fully repay traders debt", async function () {
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should close position and fully repay traders debt after n block past", async function () {
        await increaseBlocksBy(increaseBy);
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

      it("Should close position 1 block past and rest of trader deposit to traderBalanceVault when deal is loss", async function () {
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

        const depositIncrement = amountAOut.sub(BigNumber.from(positionDebt.toString()));

        await expect(() => positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0)).to.changeTokenBalance(
          testTokenA,
          traderBalanceVault,
          depositIncrement,
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
        const amountAOutPosition = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

        const { availableBalance: availableBeforeA } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        await positionManager.connect(trader).closePosition(0, trader.address, routesForClose, 0);

        const { availableBalance: availableAfterA } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(availableBeforeA).to.equal(0);
        expect(availableAfterA).to.equal(amountAOutPosition.sub(positionDebt.toString()));
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
        const amountOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const profitInA = amountOut.sub(positionDebt.toString());

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
          amountOut: amountOut,
          reason: CloseReason.CLOSE_BY_TRADER,
        };
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition,
          await getContractAt("PositionLibrary", positionManager.address),
        );
      });

      it("Should close position on multiple dexes", async function () {
        await network.provider.send("evm_mine");

        const BAR = await bucket.bar();
        const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
        const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
        const borrowIndexBefore = await bucket.variableBorrowIndex();
        const txBlockTimestamp = lastUpdBlockTimestamp.add(100);

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAmount1 = positionAmount.div(2);
        const positionAmount2 = positionAmount.sub(positionAmount1);
        const amountOut = (await getAmountsOut(dex1, positionAmount1, [testTokenB.address, testTokenA.address])).add(
          await getAmountsOut(dex2, positionAmount2, [testTokenB.address, testTokenA.address]),
        );

        const numerator = amountOut.mul(multiplierA);
        const denominator = positionAmount.mul(multiplierB);

        const limitPrice = BigNumber.from(wadDiv(numerator.toString(), denominator.toString()).toString()).div(multiplierA);
        await priceFeed.setAnswer(limitPrice);

        const profitInA = amountOut.sub(positionDebt.toString());

        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
        const tx = await positionManager.connect(trader).closePosition(
          0,
          trader.address,
          [
            {
              shares: 1,
              paths: [
                {
                  dexName: dex1,
                  encodedPath: await getEncodedPath([testTokenB.address, testTokenA.address], dex1),
                },
              ],
            },
            {
              shares: 1,
              paths: [
                {
                  dexName: dex2,
                  encodedPath: await getEncodedPath([testTokenB.address, testTokenA.address], dex2),
                },
              ],
            },
          ],
          0,
        );
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
          amountOut: amountOut,
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
      let toSwapAmountB;
      before(async function () {
        await addLiquidity({
          dex: dex1,
          from: "lender",
          tokenA: testTokenA,
          tokenB: testTokenB,
          amountADesired: "100",
          amountBDesired: "100",
          createPool: false,
        });
        const amount0Out = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const leverage = BigNumber.from(WAD).add(wadDiv(amount0Out.toString(), depositAmountB.toString()).toString());
        const feeAmountCalculateWithETHRate = wadMul(
          wadMul(depositAmountB.toString(), leverage.toString()),
          protocolRate.toString(),
        ).toString();
        feeAmountInEth = wadMul(
          BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierB).toString(),
          PriceInETH.toString(),
        ).toString();

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;

        await testTokenB.connect(trader).approve(positionManager.address, depositAmountB);

        await positionManager.connect(trader).openPosition(
          {
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetRoutes: [],
            },
            firstAssetRoutes: firstAssetRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
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
          toSwapAmountB = parseUnits("40", decimalsB);
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

      it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("80", decimalsB).toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const { positionAmount } = await positionManager.getPosition(0);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        let dexExchangeRate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        dexExchangeRate = BigNumber.from(dexExchangeRate).div(multiplierA);
        await setBadOraclePrice(priceFeed, fivePercent, true, dexExchangeRate);

        await expect(
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Shouldn't liquidate position until it not risky", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        let dexExchangeRate = wadDiv(positionAssetCurrentPriceInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
        dexExchangeRate = BigNumber.from(dexExchangeRate).div(multiplierA);
        await priceFeed.setDecimals(decimalsA);
        await priceFeed.setAnswer(dexExchangeRate);
        await expect(
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.91wad", async function () {
        const bnWAD = BigNumber.from(WAD.toString());
        const { positionAmount } = await positionManager.getPosition(0);
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

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalance(testTokenA, pair, positionAssetCurrentPrice.mul(NegativeOne));
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
        await increaseBlocksBy(increaseBy);
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
        const amountOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);

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
          amountOut: amountOut,
          reason: CloseReason.RISKY_POSITION,
        };

        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition,
          await getContractAt("PositionLibrary", positionManager.address),
        );
      });

      it("Should liquidate risky position and transfer to Treasury rest of trader deposit", async function () {
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

        let positionDebt = await positionManager.getPositionDebt(0); // to calculate the health of the position
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
        ); // to calculate rest of trader deposit

        expect(await positionManager.healthPosition(0)).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        const returnedToTrader = positionAssetCurrentPrice.sub(positionDebt.toString());

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalance(testTokenA, Treasury, returnedToTrader);
        const { availableBalance: availableTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(availableTrader).to.equal(0);
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

        await expect(() =>
          positionManager
            .connect(liquidator)
            .closePositionByCondition(0, liquidator.address, routesForClose, MaxUint256, [], CloseReason.RISKY_POSITION, []),
        ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toFixed());
      });

      it("Should liquidate risky position on multiple dexes", async function () {
        await swapExactTokensForTokens({
          dex: dex2,
          amountIn: parseUnits("400", decimalsB).toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        for (let i = 0; i < 3; i++) {
          await network.provider.send("evm_mine");
        }

        const positionId = 0;
        const { positionAmount } = await positionManager.getPosition(positionId);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPrice = (await getAmountsOut(dex1, positionAmount.div(2), [testTokenB.address, testTokenA.address])).add(
          await getAmountsOut(dex2, positionAmount.div(2), [testTokenB.address, testTokenA.address]),
        );
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

        const firstPartToSwap = positionAmount.div(2);
        const amountOut = (await getAmountsOut(dex1, firstPartToSwap, [testTokenB.address, testTokenA.address])).add(
          await getAmountsOut(dex2, positionAmount.sub(firstPartToSwap), [testTokenB.address, testTokenA.address]),
        );

        const tx = await positionManager
          .connect(liquidator)
          .closePositionByCondition(
            0,
            liquidator.address,
            (
              await getSingleRoute([testTokenB.address, testTokenA.address], dex1)
            ).concat(await getSingleRoute([testTokenB.address, testTokenA.address], dex2)),
            MaxUint256,
            [],
            CloseReason.RISKY_POSITION,
            [],
          );
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
          amountOut: amountOut,
          reason: CloseReason.RISKY_POSITION,
        };
        eventValidation(
          "ClosePosition",
          await tx.wait(),
          expectedClosePosition,
          await getContractAt("PositionLibrary", positionManager.address),
        );
      });
    });
  });

  describe("LimitOrderManager", function () {
    let leverage, feeAmountInPmx;
    before(async function () {
      leverage = parseEther("5");
      const positionSize = wadMul(depositAmountB.toString(), leverage.toString()).toString();
      const feeAmountCalculateWithPMXRate = wadMul(
        BigNumber.from(positionSize).mul(multiplierB).toString(),
        limitOrderProtocolRateInPmx.toString(),
      ).toString();
      feeAmountInPmx = wadMul(feeAmountCalculateWithPMXRate.toString(), ttbPriceInPMX.toString()).toString();
      const feeAmountCalculateWithETHRate = wadMul(
        BigNumber.from(positionSize).mul(multiplierB).toString(),
        limitOrderProtocolRate.toString(),
      ).toString();
      feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();
      await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: BigNumber.from(feeAmountInEth).mul(3) });
    });
    describe("openPositionByOrder", function () {
      let snapshotId, orderId, feeInPmxOderId, slPrice, tpPrice, exchangeRate, dexRate, defaultAdditionalParams;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;
        await positionManager.setDefaultOracleTolerableLimit(parseEther("0.01"));
        const amountToTransfer = parseUnits("5", decimalsA);
        const amountToTransferInWadDecimalsFromDex = parseEther("5");
        const amountOutFromDex = await getAmountsOut(dex1, amountToTransfer, [testTokenA.address, testTokenB.address]);
        const amountOutInWadDecimals = amountOutFromDex.mul(multiplierB);
        dexRate = BigNumber.from(wadDiv(amountToTransferInWadDecimalsFromDex.toString(), amountOutInWadDecimals.toString()).toString()).div(
          multiplierA,
        );
        await priceFeed.setAnswer(dexRate);
        await priceFeed.setDecimals(decimalsA);

        depositInBorrowedAmount = await primexPricingLibrary.getOracleAmountsOut(
          testTokenB.address,
          testTokenA.address,
          depositAmountB,
          priceOracle.address,
        );

        const amountToSwap = wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const amountTokenB = await getAmountsOut(dex1, amountToSwap, [testTokenA.address, testTokenB.address]);
        const amountToSwapInWadDecimals = BigNumber.from(amountToSwap).mul(multiplierA);
        const amountTokenBInWadDecimals = amountTokenB.mul(multiplierB);
        const rate = BigNumber.from(wadDiv(amountToSwapInWadDecimals.toString(), amountTokenBInWadDecimals.toString()).toString());
        exchangeRate = rate.div(multiplierA);

        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          exchangeRate,
          leverage,
        );
        slPrice = liquidationPrice.add(1).mul(multiplierA);
        tpPrice = exchangeRate.add(1).mul(multiplierA);

        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB);

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(dexRate))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          },
          { value: feeAmountInEth },
        );
        orderId = await limitOrderManager.ordersId();

        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB);
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(limitOrderManager.address, feeAmountInPmx);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          payFeeFromWallet: payFeeFromWallet,
          isProtocolFeeInPmx: true,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(dexRate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
        });
        feeInPmxOderId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, []);
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

      it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await setBadOraclePrice(priceFeed, fivePercent, false);

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
      it("Should create position by order when stopLoss=0, takeProfit=0", async function () {
        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB);

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;
        const slPrice = 0;
        const tpPrice = 0;
        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(dexRate))],
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
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });
      });

      it("Should create position by order and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
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
          testTokenA,
          [bucket],
          [
            wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString())
              .multipliedBy(NegativeOne.toString())
              .toString(),
          ],
        );
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order, increase traders count, add traderPositions and then deleted the order", async function () {
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutes,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });
        const borrowIndex = await bucket.variableBorrowIndex();
        const borrowedAmount = wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position = await positionManager.getPosition(0);
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositInBorrowedAmount);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amount0Out.add(depositAmountB).toString());
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should open position by order and top-up Treasury balance by fee amount in eth", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.changeEtherBalances([traderBalanceVault, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);
      });

      it("Should create 'Position' with isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, feeAmountInPmx);
        await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

        const traderReserveBalancesBefore = await traderBalanceVault.balances(trader.address, PMXToken.address);

        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: feeInPmxOderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetRoutes: firstAssetRoutes,
            depositInThirdAssetRoutes: [],
            keeper: liquidator.address,
          }),
        ).to.changeTokenBalances(
          PMXToken,
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
        );

        const traderReserveBalancesAfter = await traderBalanceVault.balances(trader.address, PMXToken.address);
        expect(traderReserveBalancesBefore.lockedBalance.sub(traderReserveBalancesAfter.lockedBalance)).to.equal(feeAmountInPmx);
      });

      it("Should create position by order on multiple dexes, increase traders count, add traderPositions and then deleted the order", async function () {
        const amount0 = BigNumber.from(wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString()).toString());
        const amount0Out = (await getAmountsOut(dex1, amount0.div(2), [testTokenA.address, testTokenB.address])).add(
          await getAmountsOut(dex2, amount0.div(2), [testTokenA.address, testTokenB.address]),
        );

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetRoutes: firstAssetRoutesOnDex1and2,
          depositInThirdAssetRoutes: [],
          keeper: liquidator.address,
        });
        const borrowIndex = await bucket.variableBorrowIndex();
        const scaledDebtAmount = rayDiv(amount0.toString(), borrowIndex.toString()).toString();
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position = await positionManager.getPosition(0);
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositInBorrowedAmount);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amount0Out.add(depositAmountB).toString());
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });
    });
    describe("canBeFilled", function () {
      let snapshotId, slPrice, tpPrice, limitPrice, params, defaultAdditionalParams, conditionIndex;
      let orderId1, orderId2, orderId3;
      before(async function () {
        conditionIndex = 0;

        // 2 orders with fee in depositAsset
        // 1 order with fee in PMX
        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB.mul(3));
        await positionManager.setDefaultOracleTolerableLimit(parseEther("0.01"));

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const payFeeFromWallet = true;

        const depositInBorrowedAmountFromDex = await getAmountsOut(dex1, depositAmountB, [testTokenB.address, testTokenA.address]);
        const amountInFromDex = wadMul(depositInBorrowedAmountFromDex.toString(), leverage.toString()).toString();
        const amountToTransferFromDex = BigNumber.from(amountInFromDex).sub(depositInBorrowedAmountFromDex);
        const amountToTransferInWadDecimalsFromDex = amountToTransferFromDex.mul(multiplierA);
        const amountOutFromDex = await getAmountsOut(dex1, amountToTransferFromDex, [testTokenA.address, testTokenB.address]);
        const amountOutInWadDecimals = amountOutFromDex.mul(multiplierB);
        const rate = BigNumber.from(wadDiv(amountToTransferInWadDecimalsFromDex.toString(), amountOutInWadDecimals.toString()).toString());
        const exchangeRate = rate.div(multiplierA);
        await priceFeed.setAnswer(exchangeRate);
        await priceFeed.setDecimals(decimalsA);

        depositInBorrowedAmount = await primexPricingLibrary.getOracleAmountsOut(
          testTokenB.address,
          testTokenA.address,
          depositAmountB,
          priceOracle.address,
        );
        const amountIn = wadMul(depositInBorrowedAmount.toString(), leverage.toString()).toString();
        const amountToTransfer = BigNumber.from(amountIn).sub(depositInBorrowedAmount);
        const amountOut = await getAmountsOut(dex1, amountToTransfer, [testTokenA.address, testTokenB.address]);
        const amountInInWad = BigNumber.from(amountIn).mul(multiplierA);
        const denominatorInWadDecimals = amountOut.add(depositAmountB).mul(multiplierB);
        limitPrice = BigNumber.from(wadDiv(amountInInWad.toString(), denominatorInWadDecimals.toString()).toString());
        limitPrice = limitPrice.div(multiplierA);

        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          limitPrice,
          leverage,
        );
        slPrice = limitPrice.sub(limitPrice.sub(liquidationPrice).div(2)).mul(multiplierA);
        tpPrice = limitPrice.add(limitPrice.add(liquidationPrice).div(2)).mul(multiplierA);

        await limitOrderManager.connect(trader).createLimitOrder(
          {
            bucket: "bucket1",
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
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
        // limit order with isProtocolFeeInPmx=true
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          deadline: deadline,
          isProtocolFeeInPmx: true,
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
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            payFeeFromWallet: payFeeFromWallet,
            leverage: leverage,
            shouldOpenPosition: true,
            openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice.sub(1)))],
            closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          },
          { value: feeAmountInEth },
        );
        orderId3 = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, []);
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
          depositInThirdAssetRoutes: [],
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
      it("Should revert when depositAsset is positionAsset and depositInThirdAssetRoutes length isn't 0", async function () {
        const additionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, firstAssetRoutes);
        await expect(
          limitOrderManager.connect(liquidator).canBeFilled(orderId1, conditionIndex, additionalParams),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0");
        params.depositInThirdAssetRoutes = firstAssetRoutes;

        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0",
        );
      });
      it("Should revert when depositAsset is positionAsset and firstAssetRoutes length is empty", async function () {
        const additionalParams = getLimitPriceAdditionalParams([], []);
        await expect(
          limitOrderManager.connect(liquidator).canBeFilled(orderId1, conditionIndex, additionalParams),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
        params.firstAssetRoutes = [];
        await expect(limitOrderManager.connect(liquidator).openPositionByOrder(params)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
        );
      });
      it("Should return true when limitPrice is more than current price on dex and there's enough pmx in trader traderBalanceVault", async function () {
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
