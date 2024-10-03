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
  MAX_TOKEN_DECIMALITY,
  CloseReason,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  FeeRateType,
  USD_DECIMALS,
  USD_MULTIPLIER,
} = require("./utils/constants");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { increaseBlocksBy } = require("./utils/hardhatUtils");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const { calculateFeeInPositionAsset, calculateFeeAmountInPmx } = require("./utils/protocolUtils");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("./utils/conditionParams");
const {
  getAmountsOut,
  addLiquidity,
  swapExactTokensForTokens,
  getPair,
  getEncodedPath,
  getSingleMegaRoute,
} = require("./utils/dexOperations");
const { eventValidation } = require("./utils/eventValidation");
const {
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
  getExchangeRateByRoutes,
  setBadOraclePrice,
} = require("./utils/oracleUtils");
process.env.TEST = true;

describe("DepositAsset_isPositionAsset", function () {
  let dex1,
    dex2,
    positionManager,
    limitOrderManager,
    traderBalanceVault,
    Treasury,
    PMXToken,
    testTokenA,
    testTokenB,
    bucket,
    primexPricingLibrary,
    primexPricingLibraryMock,
    firstAssetMegaRoutes,
    routesForClose,
    firstAssetRoutesOnDex1and2,
    decimalsA,
    decimalsB,
    decimalsX,
    priceOracle,
    oracleDataParams;
  let trader, lender, liquidator, pair, debtTokenA, testTokenX, snapshotIdBase, PrimexDNS, bucketAddress, ErrorsLibrary;
  let multiplierA, multiplierB;
  let increaseBy;
  let depositAmountB, borrowedAmount, amountOutMin, positionAmount, depositInBorrowedAmount;

  before(async function () {
    await fixture(["Test"]);
    ({ trader, lender, liquidator } = await getNamedSigners());
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

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

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

    firstAssetMegaRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex1);
    routesForClose = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex1);
    firstAssetRoutesOnDex1and2 = firstAssetMegaRoutes.concat(await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex2));

    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenB, amountADesired: "100", amountBDesired: "100" });
    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenA, tokenB: testTokenX, amountADesired: "100", amountBDesired: "100" });
    await addLiquidity({ dex: dex1, from: "lender", tokenA: testTokenB, tokenB: testTokenX, amountADesired: "100", amountBDesired: "100" });

    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB, amountADesired: "85", amountBDesired: "100" });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenX, amountADesired: "85", amountBDesired: "100" });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenB, tokenB: testTokenX, amountADesired: "85", amountBDesired: "100" });

    const pairAddress = await getPair(dex1, testTokenA.address, testTokenB.address);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);

    priceOracle = await getContract("PriceOracle");
    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, testTokenB, parseUnits("1", USD_DECIMALS));
    await setupUsdOraclesForTokens(testTokenB, testTokenX, parseUnits("1", USD_DECIMALS));

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenB, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);

    await setupUsdOraclesForTokens(testTokenA, PMXToken, parseUnits("0.2", USD_DECIMALS));
    await setupUsdOraclesForTokens(testTokenX, PMXToken, parseUnits("0.2", USD_DECIMALS));
    await setupUsdOraclesForTokens(await priceOracle.eth(), PMXToken, parseUnits("0.666", USD_DECIMALS));

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    depositAmountB = parseUnits("1", decimalsB);
    borrowedAmount = parseUnits("2", decimalsA);
    amountOutMin = 0;
    const lenderAmount = parseUnits("1000", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    const amount0Out = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
    const amount0OutInWadDecimals = amount0Out.mul(multiplierB);
    const borrowedAmountInWadDecimals = borrowedAmount.mul(multiplierA);
    const price = wadDiv(amount0OutInWadDecimals.toString(), borrowedAmountInWadDecimals.toString()).toString();
    const limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, limitPrice);

    positionAmount = depositAmountB.add(amount0Out);

    const rate = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
    depositInBorrowedAmount = BigNumber.from(wadMul(depositAmountB.toString(), rate.toString()).toString());

    increaseBy = 2628000; // calculated for a year from average 7200 blocks per day on Ethereum
    const { payload: payload1 } = await encodeFunctionData("setMaintenanceBuffer", [parseEther("0.01")], "PositionManagerExtension");
    await positionManager.setProtocolParamsByAdmin(payload1);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("PositionManager", function () {
    describe("openPosition", function () {
      let snapshotId;
      let takeDepositFromWallet;
      before(async function () {
        takeDepositFromWallet = false;
        await testTokenB.connect(trader).approve(traderBalanceVault.address, depositAmountB);
        await traderBalanceVault.connect(trader).deposit(testTokenB.address, depositAmountB);
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
        oracleDataParams = {
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
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
      it("Should revert open position when not allowed token (testTokenX)", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenX.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
      });
      it("Should revert when firstAssetMegaRoutes:is empty list", async function () {
        const borrowedAmountInternal = borrowedAmount.div(2);
        const depositAmountInternal = depositAmountB.div(2);
        const amount0Out = (await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address])).add(depositAmountB);
        oracleDataParams.firstAssetOracleData = [];

        const amountOutMin = amount0Out;
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmountInternal,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: [],
            depositAsset: testTokenB.address,
            depositAmount: depositAmountInternal,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
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
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });

      it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
        const borrowedAmountInternal = borrowedAmount.div(4);
        const depositAmountInternal = depositAmountB.div(4);
        let amount0Out = await getAmountsOut(dex1, borrowedAmountInternal, [testTokenA.address, testTokenB.address]);
        const borrowedAmountInternalInWadDecimals = borrowedAmountInternal.mul(multiplierA);
        let amount0OutInWadDecimals = amount0Out.mul(multiplierB);

        let price = wadDiv(amount0OutInWadDecimals.toString(), borrowedAmountInternalInWadDecimals.toString()).toString();
        let limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        let amountOutMin = amount0Out.add(depositAmountInternal);
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmountInternal,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountInternal,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });

        amount0Out = await getAmountsOut(dex1, borrowedAmountInternal, [testTokenA.address, testTokenB.address]);
        amount0OutInWadDecimals = amount0Out.mul(multiplierB);
        amountOutMin = amount0Out.add(depositAmountInternal);
        price = wadDiv(amount0OutInWadDecimals.toString(), borrowedAmountInternalInWadDecimals.toString()).toString();
        limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmountInternal,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountInternal,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin.sub(1),
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
      });

      it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await setBadOraclePrice(testTokenA, testTokenB);

        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
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
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
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
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalances(
          testTokenB,
          [positionManager, traderBalanceVault],
          [positionAmount, depositAmountB.mul(NegativeOne)],
        );

        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenB.address);
        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountB);
      });

      it("Should create 'Position' with isProtocolFeeInPmx=true", async function () {
        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);
        const deadline = new Date().getTime() + 600;
        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            isProtocolFeeInPmx: true,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.changeTokenBalances(testTokenB, [positionManager, traderBalanceVault], [positionAmount, depositAmountB.mul(NegativeOne)]);

        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenB.address);

        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountB);
      });

      it("Should create position and increase traders count, and add traderPositions", async function () {
        const deadline = new Date().getTime() + 600;

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
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
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
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
          entryPrice: entryPrice,
          leverage: leverage,
          closeConditions: [],
        };

        eventValidation("OpenPosition", await txOpenPosition.wait(), expectedArguments);
      });

      it("Should open position on multiple dexes", async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = false;

        const amountBOut = (await getAmountsOut(dex1, borrowedAmount.div(2), [testTokenA.address, testTokenB.address])).add(
          await getAmountsOut(dex2, borrowedAmount.div(2), [testTokenA.address, testTokenB.address]),
        );

        const rate = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const amountAOut = BigNumber.from(wadMul(depositAmountB.toString(), rate.toString()).toString());

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetRoutesOnDex1and2,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
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
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.emit(positionManager, "OpenPosition");
      });

      it("Should revert when position size < minPositionSize", async function () {
        const deadline = new Date().getTime() + 600;
        const depositAmountB = parseUnits("0.01", decimalsB);
        const borrowedAmount = parseUnits("0.01", decimalsA);
        const gasPrice = parseUnits("1000", "gwei");
        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetMegaRoutes: [],
              },
              firstAssetMegaRoutes: firstAssetMegaRoutes,
              depositAsset: testTokenB.address,
              depositAmount: depositAmountB,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              closeConditions: [],
              ...oracleDataParams,
            },
            { gasPrice },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
    });

    describe("openPosition with deposit", function () {
      let snapshotId;
      let takeDepositFromWallet;

      before(async function () {
        takeDepositFromWallet = true;
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
        oracleDataParams = {
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
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

      it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
        const amount0Out = (await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address])).add(depositAmountB);
        const amountOutMin = amount0Out.add(1);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });

      it("Should revert when deposit Amount on dex insufficient for deal", async function () {
        const depositAmountB = parseUnits("1", decimalsB);
        const borrowedAmount = parseUnits("10", decimalsA);

        const amount0Out = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const numerator = amount0Out.mul(multiplierB);
        const denominator = borrowedAmount.mul(multiplierA);

        const price = BigNumber.from(wadDiv(numerator.toString(), denominator.toString()).toString()).div(multiplierA);
        const limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        const deadline = new Date().getTime() + 600;

        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenB.address);
        expect(availableBalance).to.equal(0);
        expect(lockedBalance).to.equal(0);

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_DEPOSIT");

        const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
          trader.address,
          testTokenB.address,
        );
        expect(availableAfter).to.equal(0);
        expect(lockedAfter).to.equal(0);
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await setBadOraclePrice(testTokenA, testTokenB);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Should revert openPosition with isProtocolFeeInPmx=true and takeDepositFromWallet = false if trader doesn't have enough pmx in traderBalanceVault", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: [],
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenB.address,
            depositAmount: depositAmountB,
            isProtocolFeeInPmx: true,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: false,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_FREE_ASSETS");
      });
      it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
        const halfBorrowedAmount = borrowedAmount.div(2);
        const halfDepositAmountB = depositAmountB.div(2);

        let amount0Out = await getAmountsOut(dex1, halfBorrowedAmount, [testTokenA.address, testTokenB.address]);
        let amountOutMin = amount0Out.add(halfDepositAmountB);
        const deadline = new Date().getTime() + 600;

        let price = wadDiv(amount0Out.toString(), halfBorrowedAmount.toString()).toString();
        let limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: halfBorrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: halfDepositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });

        amount0Out = await getAmountsOut(dex1, halfBorrowedAmount, [testTokenA.address, testTokenB.address]);
        amountOutMin = amount0Out.add(halfDepositAmountB);

        price = wadDiv(amount0Out.toString(), halfBorrowedAmount.toString()).toString();
        limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: halfBorrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: halfDepositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
      });

      it("Should not lock tokens in traderBalanceVault as a collateral for deal", async function () {
        const deadline = new Date().getTime() + 600;
        const { lockedBalance: lockedBalanceTraderAbefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalance(testTokenB, trader, depositAmountB.mul(NegativeOne));

        const { lockedBalance: lockedBalanceTraderAafter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(lockedBalanceTraderAafter.sub(lockedBalanceTraderAbefore)).to.equal(0);
      });
      it("Should create 'Position' with isProtocolFeeInPmx=true", async function () {
        const deadline = new Date().getTime() + 600;
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          isProtocolFeeInPmx: true,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalances(
          testTokenB,
          [trader, positionManager, traderBalanceVault],
          [depositAmountB.mul(NegativeOne), positionAmount, 0],
        );
      });
    });

    describe("closePosition", function () {
      let snapshotId;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenB.connect(trader).approve(positionManager.address, depositAmountB);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
        });

        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const amountAOut = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
        const price2 = wadDiv(positionAmountInWadDecimals.toString(), amountAOutInWadDecimals.toString()).toString();
        const limitPrice2 = BigNumber.from(price2).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice2);
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
        await expect(
          positionManager
            .connect(lender)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.be.reverted;
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
        await setBadOraclePrice(testTokenB, testTokenA);

        await expect(
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should close position and transfer testTokenB from 'PositionManager' to 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);

        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.changeTokenBalances(
          testTokenB,
          [positionManager, pair, Treasury],
          [positionAmount.mul(NegativeOne), positionAmountAfterFee, feeInPositionAsset],
        );
      });

      it("Should close position and transfer testTokenA from 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);

        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.changeTokenBalance(testTokenA, pair, amountAOut.mul(NegativeOne));
      });

      it("Should close position and delete trader position from traderPositions list", async function () {
        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
          );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
      });

      it("Should close position and fully repay traders debt", async function () {
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
          );

        expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
      });

      it("Should close position and fully repay traders debt after n block past", async function () {
        await increaseBlocksBy(increaseBy);
        expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
        expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
          );

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

        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toFixed());
      });

      it("Should close position 1 block past and rest of trader deposit to traderBalanceVault when deal is loss", async function () {
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);

        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.changeTokenBalance(testTokenA, traderBalanceVault, amountAOut.sub(positionDebt.toString()));

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

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

        const depositIncrement = amountAOut.sub(BigNumber.from(positionDebt.toString()));
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.changeTokenBalance(testTokenA, traderBalanceVault, depositIncrement);

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

        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              routesForClose,
              0,
              getEncodedChainlinkRouteViaUsd(testTokenA),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              getEncodedChainlinkRouteViaUsd(testTokenB),
              [],
            ),
        ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toString());
      });

      it("Should close position 1 block after and add amount to available balance in TraderBalanceVault", async function () {
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const amountAOutPosition = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

        const { availableBalance: availableBeforeA } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
          );

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

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const amountOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);
        const profitInA = amountOut.sub(positionDebt.toString());
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        const tx = await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            routesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
          );
        const expectedClosePosition = {
          positionI: 0,
          trader: trader.address,
          closedBy: trader.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmountAfterFee,
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByTrader,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const positionAmount1 = positionAmountAfterFee.div(2);
        const positionAmount2 = positionAmountAfterFee.sub(positionAmount1);
        const amountOut = (await getAmountsOut(dex1, positionAmount1, [testTokenB.address, testTokenA.address])).add(
          await getAmountsOut(dex2, positionAmount2, [testTokenB.address, testTokenA.address]),
        );

        const numerator = positionAmount.mul(multiplierB);
        const denominator = amountOut.mul(multiplierA);

        const limitPrice = BigNumber.from(wadDiv(numerator.toString(), denominator.toString()).toString()).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        const profitInA = amountOut.sub(positionDebt.toString());

        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
        const tx = await positionManager.connect(trader).closePosition(
          0,
          trader.address,
          [
            {
              shares: 1,
              routes: [
                {
                  to: testTokenA.address,
                  paths: [
                    {
                      dexName: dex1,
                      shares: 1,
                      payload: await getEncodedPath([testTokenB.address, testTokenA.address], dex1),
                    },
                    {
                      dexName: dex2,
                      shares: 1,
                      payload: await getEncodedPath([testTokenB.address, testTokenA.address], dex2),
                    },
                  ],
                },
              ],
            },
          ],
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
        );
        const expectedClosePosition = {
          positionI: 0,
          trader: trader.address,
          closedBy: trader.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmountAfterFee,
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
      let ClosePositionByConditionParams;
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

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        await testTokenB.connect(trader).approve(positionManager.address, depositAmountB);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: [],
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
        });

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
        ClosePositionByConditionParams = {
          id: 0,
          keeper: liquidator.address,
          megaRoutes: routesForClose,
          conditionIndex: MaxUint256,
          ccmAdditionalParams: [],
          closeReason: CloseReason.RISKY_POSITION,
          positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pullOracleData: [],
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

      it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("80", decimalsB).toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        await setBadOraclePrice(testTokenA, testTokenB);

        await expect(
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Shouldn't liquidate position until it not risky", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        let dexExchangeRate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        dexExchangeRate = BigNumber.from(dexExchangeRate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);
        await expect(
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.91wad", async function () {
        const bnWAD = BigNumber.from(WAD.toString());
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const limitPrice = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        await setOraclePrice(testTokenA, testTokenB, BigNumber.from(limitPrice).div(USD_MULTIPLIER));
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        const positionDebt = await positionManager.getPositionDebt(0);
        const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), priceFromOracle.toString()).toString();
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
        expect(await positionManager.callStatic.healthPosition(0, getEncodedChainlinkRouteViaUsd(testTokenA), [])).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        await expect(() =>
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmountAfterFee]);
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.99wad", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const bnWAD = BigNumber.from(WAD.toString());

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const limitPrice = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        await setOraclePrice(testTokenA, testTokenB, BigNumber.from(limitPrice).div(USD_MULTIPLIER));

        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        const positionDebt = await positionManager.getPositionDebt(0);
        const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), priceFromOracle.toString()).toString();
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
        expect(await positionManager.callStatic.healthPosition(0, getEncodedChainlinkRouteViaUsd(testTokenA), [])).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        await expect(() =>
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmountAfterFee]);
      });

      it("Should liquidate risky position and transfer testTokenA from 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const bnWAD = BigNumber.from(WAD.toString());

        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const limitPrice = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        await setOraclePrice(testTokenA, testTokenB, BigNumber.from(limitPrice).div(USD_MULTIPLIER));

        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        const positionDebt = await positionManager.getPositionDebt(0);
        const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), priceFromOracle.toString()).toString();
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

        expect(await positionManager.callStatic.healthPosition(0, getEncodedChainlinkRouteViaUsd(testTokenA), [])).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        await expect(() =>
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

        await positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams });

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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);
        await positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams });

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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
        const amountOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

        const tx = await positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams });
        const expectedClosePosition = {
          positionI: 0,
          trader: trader.address,
          closedBy: liquidator.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmountAfterFee,
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const bnWAD = BigNumber.from(WAD.toString());
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: toSwapAmountB.toString(),
          path: [testTokenB.address, testTokenA.address],
        });

        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const limitPrice = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        await setOraclePrice(testTokenA, testTokenB, BigNumber.from(limitPrice).div(USD_MULTIPLIER));
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        let positionDebt = await positionManager.getPositionDebt(0); // to calculate the health of the position
        const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
        let amount0OutOracle = wadMul(positionAmountInWadDecimals.toString(), priceFromOracle.toString()).toString();
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

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        ); // to calculate rest of trader deposit

        expect(await positionManager.callStatic.healthPosition(0, getEncodedChainlinkRouteViaUsd(testTokenA), [])).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);

        const returnedToTrader = positionAssetCurrentPrice.sub(positionDebt.toString());
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
        await expect(() =>
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams }),
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const positionAmountAfterFee = positionAmount.sub(feeInPositionAsset);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPrice = (
          await getAmountsOut(dex1, positionAmountAfterFee.div(2), [testTokenB.address, testTokenA.address])
        ).add(await getAmountsOut(dex2, positionAmount.div(2), [testTokenB.address, testTokenA.address]));
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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

        const firstPartToSwap = positionAmountAfterFee.div(2);
        const amountOut = (await getAmountsOut(dex1, firstPartToSwap, [testTokenB.address, testTokenA.address])).add(
          await getAmountsOut(dex2, positionAmountAfterFee.sub(firstPartToSwap), [testTokenB.address, testTokenA.address]),
        );
        ClosePositionByConditionParams.megaRoutes = (await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex1)).concat(
          await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex2),
        );
        const tx = await positionManager.connect(liquidator).closePositionByCondition({ ...ClosePositionByConditionParams });
        const expectedClosePosition = {
          positionI: 0,
          trader: trader.address,
          closedBy: liquidator.address,
          bucketAddress: bucket.address,
          soldAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          decreasePositionAmount: positionAmountAfterFee,
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
    let leverage, ethAddress;
    before(async function () {
      leverage = parseEther("5");
    });
    describe("openPositionByOrder", function () {
      let snapshotId, orderId, feeInPmxOderId, slPrice, tpPrice, exchangeRate, dexRate, defaultAdditionalParams;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const { payload } = await encodeFunctionData("setDefaultOracleTolerableLimit", [parseEther("0.01")], "PositionManagerExtension");
        await positionManager.setProtocolParamsByAdmin(payload);
        const amountToTransfer = parseUnits("5", decimalsA);
        const amountToTransferInWadDecimalsFromDex = parseEther("5");
        const amountOutFromDex = await getAmountsOut(dex1, amountToTransfer, [testTokenA.address, testTokenB.address]);
        const amountOutInWadDecimals = amountOutFromDex.mul(multiplierB);
        ethAddress = await priceOracle.eth();
        dexRate = BigNumber.from(wadDiv(amountToTransferInWadDecimalsFromDex.toString(), amountOutInWadDecimals.toString()).toString()).div(
          multiplierA,
        );
        const price = BigNumber.from(
          wadDiv(amountOutInWadDecimals.toString(), amountToTransferInWadDecimalsFromDex.toString()).toString(),
        ).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, price);

        const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));
        depositInBorrowedAmount = BigNumber.from(wadMul(depositAmountB.toString(), priceFromOracle.toString()).toString());

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

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(dexRate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        });
        orderId = await limitOrderManager.ordersId();

        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          isProtocolFeeInPmx: true,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(dexRate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        });
        feeInPmxOderId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, []);
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
        await setBadOraclePrice(testTokenA, testTokenB);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Should create position by order when stopLoss=0, takeProfit=0", async function () {
        await testTokenB.connect(trader).approve(limitOrderManager.address, depositAmountB);

        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        const slPrice = 0;
        const tpPrice = 0;
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenB.address,
          depositAmount: depositAmountB,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(dexRate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
        });

        const orderId = await limitOrderManager.ordersId();

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
        });
      });

      it("Should create position by order and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          amount0Out.add(depositAmountB),
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
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
        expect(position.positionAmount).to.equal(amount0Out.add(depositAmountB).sub(feeInPositionAsset).toString());
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should create 'Position' with isProtocolFeeInPmx=true", async function () {
        await PMXToken.transfer(trader.address, parseEther("1"));
        await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));

        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          amount0Out.add(depositAmountB),
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

        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: feeInPmxOderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: [],
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: [],
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
          }),
        ).to.changeTokenBalances(
          PMXToken,
          [traderBalanceVault, Treasury],
          [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
        );
      });

      it("Should create position by order on multiple dexes, increase traders count, add traderPositions and then deleted the order", async function () {
        const amount0 = BigNumber.from(wadMul(depositInBorrowedAmount.toString(), leverage.sub(parseEther("1")).toString()).toString());
        const amount0Out = (await getAmountsOut(dex1, amount0.div(2), [testTokenA.address, testTokenB.address])).add(
          await getAmountsOut(dex2, amount0.div(2), [testTokenA.address, testTokenB.address]),
        );
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          amount0Out.add(depositAmountB),
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetRoutesOnDex1and2,
          depositInThirdAssetMegaRoutes: [],
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: [],
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
        });
        const borrowIndex = await bucket.variableBorrowIndex();
        const scaledDebtAmount = rayDiv(amount0.toString(), borrowIndex.toString()).toString();
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position = await positionManager.getPosition(0);
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositInBorrowedAmount);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amount0Out.add(depositAmountB).sub(feeInPositionAsset).toString());
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });
    });
  });
});
