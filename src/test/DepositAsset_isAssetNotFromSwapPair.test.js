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
    utils: { parseEther, parseUnits, defaultAbiCoder },
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
  USD_DECIMALS,
  USD_MULTIPLIER,
  FeeRateType,
} = require("./utils/constants");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
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
const { eventValidation, parseArguments } = require("./utils/eventValidation");
const { calculateFeeInPositionAsset, calculateFeeAmountInPmx } = require("./utils/protocolUtils");
const {
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
  getExchangeRateByRoutes,
  setBadOraclePrice,
} = require("./utils/oracleUtils");

process.env.TEST = true;
describe("DepositAsset_isAssetNotFromSwapPair", function () {
  let PMXToken,
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
    bucket,
    firstAssetMegaRoutes,
    depositInThirdAssetMegaRoutes,
    routesForClose,
    oracleDataParams,
    decimalsA,
    decimalsB,
    decimalsX,
    priceOracle;
  let deployer, trader, lender, liquidator, pair, pairXB, debtTokenA, testTokenX, snapshotIdBase, PrimexDNS, bucketAddress, ErrorsLibrary;
  let multiplierA, multiplierB, multiplierX;
  let depositAmountX, borrowedAmount, amountOutMin, positionAmount, depositInBorrowedAmount;
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
    await testTokenX.mint(lender.address, parseUnits("1000", decimalsX));
    await testTokenX.mint(trader.address, parseUnits("1000", decimalsX));

    firstAssetMegaRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex1);
    depositInThirdAssetMegaRoutes = await getSingleMegaRoute([testTokenX.address, testTokenB.address], dex1);
    routesForClose = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex1);

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
    multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

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

    const priceAB = wadDiv(amountBOutWadDecimals.toString(), borrowedAmountWadDecimals.toString()).toString();
    const exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

    const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);

    positionAmount = amountBOut.add(amountBOutDeposit);

    const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
    depositInBorrowedAmount = BigNumber.from(wadMul(depositAmountX.toString(), rate.toString()).toString());

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

        await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);
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
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

      it("Should revert open position by order when token (testTokenX) not allowed", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenX.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
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
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });

      it("Should revert when depositInThirdAssetMegaRoutes sum of shares is 0", async function () {
        const borrowedAmount = parseUnits("25", decimalsA).div(2);
        const depositAmount = parseUnits("25", decimalsX).div(2);

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountBOutDeposit = await getAmountsOut(dex1, depositAmount, [testTokenX.address, testTokenB.address]);
        const amountOutMin = amountBOut.add(amountBOutDeposit);
        const deadline = new Date().getTime() + 600;

        const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
        const amountBOutWadDecimals = amountBOut.mul(multiplierB);
        const priceAB = wadDiv(amountBOutWadDecimals.toString(), borrowedAmountWadDecimals.toString()).toString();
        const exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: await getSingleMegaRoute([testTokenX.address, testTokenB.address], dex1, [], 0),
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmount,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        await setBadOraclePrice(testTokenA, testTokenB);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
        await setBadOraclePrice(testTokenA, testTokenB);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        await setBadOraclePrice(testTokenX, testTokenB);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenX.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

        await setBadOraclePrice(testTokenX, testTokenB, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
        const borrowedAmount = parseUnits("25", decimalsA).div(2);
        const depositAmountX = parseUnits("25", decimalsX).div(2);

        let amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const deadline = new Date().getTime() + 600;

        const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
        let amountBOutWadDecimals = amountBOut.mul(multiplierB);
        let priceAB = wadDiv(amountBOutWadDecimals.toString(), borrowedAmountWadDecimals.toString()).toString();
        let exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        let amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);

        let amountOutMin = amountBOut.add(amountBOutDeposit);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });

        amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        amountOutMin = amountBOut.add(amountBOutDeposit);

        amountBOutWadDecimals = amountBOut.mul(multiplierB);
        priceAB = wadDiv(amountBOutWadDecimals.toString(), borrowedAmountWadDecimals.toString()).toString();
        exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin.sub(1),
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so add extra depositAmountX in traderBalanceVault
        await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);

        await setBadOraclePrice(testTokenX, testTokenA);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so add extra depositAmountX in traderBalanceVault
        await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
        await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);

        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenX.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

        await setBadOraclePrice(testTokenX, testTokenA, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
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
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
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

      it("Should createPosition", async function () {
        const deadline = new Date().getTime() + 600;
        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalances(
          testTokenX,
          [pairXB, traderBalanceVault],
          [depositAmountX, depositAmountX.mul(NegativeOne)],
        );
        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountX);
      });

      it("Should create 'Position' and transfer testTokenX when isProtocolFeeInPmx=true", async function () {
        const deadline = new Date().getTime() + 600;

        const { availableBalance: availableBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);

        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          isProtocolFeeInPmx: true,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalances(
          testTokenX,
          [pairXB, traderBalanceVault],
          [depositAmountX, depositAmountX.mul(NegativeOne)],
        );

        const { availableBalance: availableBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        expect(availableBalanceTraderBbefore.sub(availableBalanceTraderBafter)).to.equal(depositAmountX);
      });
      it("Should create position and increase traders count, and add traderPositions", async function () {
        const deadline = new Date().getTime() + 600;
        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const priceFromOracle = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const amountAOutDeposit = BigNumber.from(wadMul(depositAmountX.toString(), priceFromOracle.toString()).toString());

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
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
        const position1 = await positionManager.getPosition(0);

        const timestamp = (await provider.getBlock("latest")).timestamp;
        const extraParams = defaultAbiCoder.encode(["address"], [testTokenB.address]);

        const position = {
          id: 0,
          scaledDebtAmount: scaledDebtAmount,
          bucket: bucket.address,
          soldAsset: testTokenA.address,
          depositAmountInSoldAsset: amountAOutDeposit,
          positionAsset: testTokenB.address,
          positionAmount: amountBOut.add(amountBOutDeposit),
          trader: trader.address,
          openBorrowIndex: borrowIndex,
          createdAt: timestamp,
          updatedConditionsAt: timestamp,
          extraParams: extraParams,
        };
        parseArguments(position, position1);
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
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
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
          entryPrice: entryPrice,
          leverage: leverage,
          closeConditions: [],
        };

        eventValidation("OpenPosition", await txOpenPosition.wait(), expectedArguments);
      });

      it("Should open position when position size >= minPositionSize", async function () {
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
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
        const gasPrice = parseUnits("500", "gwei");
        const depositAmountX = parseUnits("2", 16);
        const borrowedAmount = parseUnits("2", 16);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition(
            {
              marginParams: {
                bucket: "bucket1",
                borrowedAmount: borrowedAmount,
                depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
              },
              firstAssetMegaRoutes: firstAssetMegaRoutes,
              depositAsset: testTokenX.address,
              depositAmount: depositAmountX,
              positionAsset: testTokenB.address,
              amountOutMin: amountOutMin,
              deadline: deadline,
              takeDepositFromWallet: takeDepositFromWallet,
              closeConditions: [],
              ...oracleDataParams,
            },
            { gasPrice: gasPrice },
          ),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
      });
    });

    describe("openPosition with deposit", function () {
      let snapshotId;
      let takeDepositFromWallet;
      before(async function () {
        takeDepositFromWallet = true;
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
        oracleDataParams = {
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        await setBadOraclePrice(testTokenA, testTokenB);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

        await setBadOraclePrice(testTokenA, testTokenB, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });
      it("Should revert when deposit Amount insufficient for deal", async function () {
        const depositAmount = parseUnits("1", decimalsX);
        const borrowedAmount = parseUnits("50", decimalsA);
        const deadline = new Date().getTime() + 600;

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const borrowedAmountInWadDecimals = borrowedAmount.mul(multiplierA);
        const amountBOutInWadDecimals = amountBOut.mul(multiplierB);

        const priceAB = wadDiv(amountBOutInWadDecimals.toString(), borrowedAmountInWadDecimals.toString()).toString();
        const exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        expect(availableBalance).to.equal(0);
        expect(lockedBalance).to.equal(0);

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmount,
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

        await setBadOraclePrice(testTokenX, testTokenA);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        // With the oracle price change, getDepositInBorrowed() response the price calculated through the oracle.
        // This amount is smaller than dex amount, then leverage is bigger and fee amount is bigger
        // in this test case isn't important these amounts so approve double depositAmountX on positionManager
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX.mul(2));

        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenX.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

        await setBadOraclePrice(testTokenB, testTokenA, differentPrice);

        const deadline = new Date().getTime() + 600;

        await expect(() =>
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.changeTokenBalance(testTokenA, bucket, borrowedAmount.mul(NegativeOne));
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        await setBadOraclePrice(testTokenX, testTokenB);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
      });

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenX.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

        await setBadOraclePrice(testTokenX, testTokenB, differentPrice);
        const deadline = new Date().getTime() + 600;

        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
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
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
            positionAsset: testTokenB.address,
            amountOutMin: amountOutMin,
            deadline: deadline,
            takeDepositFromWallet: takeDepositFromWallet,
            closeConditions: [],
            ...oracleDataParams,
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
      });
      it("Should revert createPosition when isProtocolFeeInPmx=true and trader doesn't have enough protocolFee assets (pmx) on traderBalanceVault", async function () {
        const deadline = new Date().getTime() + 600;
        await expect(
          positionManager.connect(trader).openPosition({
            marginParams: {
              bucket: "bucket1",
              borrowedAmount: borrowedAmount,
              depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            },
            isProtocolFeeInPmx: true,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositAsset: testTokenX.address,
            depositAmount: depositAmountX,
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
        const borrowedAmount = parseUnits("25", decimalsA).div(2);
        const depositAmountX = parseUnits("25", decimalsX).div(2);

        let amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const borrowedAmountWadDecimals = borrowedAmount.mul(multiplierA);
        let amountBOutWadDecimals = amountBOut.mul(multiplierB);
        let priceAB = wadDiv(amountBOutWadDecimals.toString(), borrowedAmountWadDecimals.toString()).toString();
        let exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        let amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);

        let amountOutMin = amountBOut.add(amountBOutDeposit);

        const deadline = new Date().getTime() + 600;

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });

        amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        amountBOutDeposit = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        amountOutMin = amountBOut.add(amountBOutDeposit);

        amountBOutWadDecimals = amountBOut.mul(multiplierB);
        priceAB = wadDiv(amountBOutWadDecimals.toString(), borrowedAmountWadDecimals.toString()).toString();
        exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
      });

      it("Should create 'Position' and transfer testTokenX", async function () {
        const deadline = new Date().getTime() + 600;

        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalance(testTokenX, trader, depositAmountX.mul(NegativeOne));
      });

      it("Should createPosition when isProtocolFeeInPmx=true", async function () {
        const deadline = new Date().getTime() + 600;
        const tx = positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          isProtocolFeeInPmx: true,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          ...oracleDataParams,
        });
        await expect(() => tx).to.changeTokenBalances(testTokenX, [trader, traderBalanceVault], [depositAmountX.mul(NegativeOne), 0]);
      });
    });

    describe("closePosition", function () {
      let snapshotId;
      before(async function () {
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;
        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
        });

        const amountAOut = await getAmountsOut(dex1, positionAmount.toString(), [testTokenB.address, testTokenA.address]);

        const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);

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
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("5", decimalsA).toString(),
          path: [testTokenA.address, testTokenB.address],
        });
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);

        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);
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
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmountAfterFee]);
      });
      it("Should close position and transfer testTokenA rest of trader deposit from 'Pair'", async function () {
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
        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee.toString(), [testTokenB.address, testTokenA.address]);

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

        await expect(await positionManager.getTraderPositionsLength(trader.address)).to.be.eq(0);
      });

      it("Should close position and fully repay traders debt", async function () {
        expect(await debtTokenA.balanceOf(trader.address)).to.gt(borrowedAmount);
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

      it("Should close position and fully repay traders debt after 1 block past", async function () {
        await network.provider.send("evm_mine");

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

      it("Should close position and fully repay traders debt after 10 blocks past", async function () {
        for (let i = 0; i < 10; i++) {
          await network.provider.send("evm_mine");
        }

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

      it("Should close position 1 block past and transfer trader depositAfterDeal from PositionManager to TraderBalanceVault when deal is loss", async function () {
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
        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee.toString(), [testTokenB.address, testTokenA.address]);
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
        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

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
        expect(availableAfterA).to.equal(amountAOut.sub(positionDebt.toString()));
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
        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee, [testTokenB.address, testTokenA.address]);

        const profitInA = amountAOut.sub(positionDebt.toString());
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
      let depositInBorrowedAmount;
      let toSwapAmountB, closePositionByConditionParams;
      before(async function () {
        const { payload } = await encodeFunctionData("setDefaultOracleTolerableLimit", [parseEther("0.01")], "PositionManagerExtension");
        await positionManager.setProtocolParamsByAdmin(payload);
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

        depositInBorrowedAmount = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const depositAmountAInWadDecimals = depositInBorrowedAmount.mul(multiplierA);
        const depositAmountXInWadDecimals = depositAmountX.mul(multiplierX);

        const priceXA = wadDiv(depositAmountAInWadDecimals.toString(), depositAmountXInWadDecimals.toString()).toString();
        const exchangeXArate = BigNumber.from(priceXA).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenX, testTokenA, exchangeXArate);

        const amountBOut = await getAmountsOut(dex1, borrowedAmount, [testTokenA.address, testTokenB.address]);
        const borrowedAmountInWadDecimals = borrowedAmount.mul(multiplierA);
        const amountBOutInWadDecimals = amountBOut.mul(multiplierB);

        const priceAB = wadDiv(amountBOutInWadDecimals.toString(), borrowedAmountInWadDecimals.toString()).toString();
        const exchangeABrate = BigNumber.from(priceAB).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, exchangeABrate);

        await testTokenX.connect(trader).approve(positionManager.address, depositAmountX);

        await positionManager.connect(trader).openPosition({
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          },
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          amountOutMin: amountOutMin,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          closeConditions: [],
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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
        closePositionByConditionParams = {
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
      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
        await swapExactTokensForTokens({
          dex: dex1,
          amountIn: parseUnits("25", decimalsB).toString(),
          path: [testTokenA.address, testTokenB.address],
        });
        await setOraclePrice(testTokenX, testTokenA, parseUnits("1", USD_DECIMALS));
        const { positionAmount } = await positionManager.getPosition(0);
        const positionAssetCurrentPrice = await getAmountsOut(dex1, positionAmount, [testTokenB.address, testTokenA.address]);
        const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
        const positionAssetCurrentPriceInWadDecimals = positionAssetCurrentPrice.mul(multiplierA);
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setBadOraclePrice(testTokenB, testTokenA, dexExchangeRate);

        await expect(
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
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

        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

        await expect(
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON");
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.91wad", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          false,
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

        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmountAfterFee]);
      });

      it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.99wad", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          false,
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

        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
        ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmountAfterFee]);
      });

      it("Should liquidate risky position and transfer testTokenA from 'Pair'", async function () {
        const { positionAmount } = await positionManager.getPosition(0);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          false,
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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

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

        const amountAOut = await getAmountsOut(dex1, positionAmountAfterFee.toString(), [testTokenB.address, testTokenA.address]);
        await expect(() =>
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

        await positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams });

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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

        await positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams });

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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

        await positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams });

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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);

        await positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams });
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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          false,
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

        const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
        const positionDebt = rayMul(
          scaledDebtBalance.toString(),
          rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
        );
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
        const priceFromOracle = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        depositInBorrowedAmount = BigNumber.from(wadMul(depositAmountX.toString(), priceFromOracle.toString()).toString());

        const tx = await positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams });

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
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginPositionClosedByKeeper,
          0,
          false,
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
        const rate = wadDiv(positionAmountInWadDecimals.toString(), positionAssetCurrentPriceInWadDecimals.toString()).toString();
        const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, dexExchangeRate);
        const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
        const feeBuffer = await bucket.feeBuffer();

        let positionDebt = await positionManager.getPositionDebt(0);
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
        );

        const returnedToTrader = positionAssetCurrentPrice.sub(positionDebt.toString());

        expect(await positionManager.callStatic.healthPosition(0, getEncodedChainlinkRouteViaUsd(testTokenA), [])).to.equal(positionState);
        expect(BigNumber.from(positionState)).to.be.lt(WAD);
        await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

        await expect(() =>
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
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
          positionManager.connect(liquidator).closePositionByCondition({ ...closePositionByConditionParams }),
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

        dex = "uniswap";

        const swapSize = depositAmount.add(borrowedAmount);
        const swap = swapSize.mul(multiplierA);
        const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
        const amountB = amount0Out.mul(multiplierB);
        const price = wadDiv(amountB.toString(), swap.toString()).toString();
        const limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPrice);

        await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);

        await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);

        positionId = await positionManager.positionsId();

        assetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);

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
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
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
            await getSingleMegaRoute([testTokenX.address, testTokenA.address], dex),
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
        ethAddress,
        defaultAdditionalParams;
      before(async function () {
        leverage = parseEther("2.5");
        depositAmountX = parseUnits("5", decimalsX);
        await testTokenX.connect(trader).approve(limitOrderManager.address, depositAmountX.add(depositAmountX));
        ethAddress = await priceOracle.eth();
        const deadline = new Date().getTime() + 600;
        const takeDepositFromWallet = true;

        const depositAmountAFromDex = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenA.address]);
        const depositAmountXInWadDecimals = depositAmountX.mul(multiplierX);
        const depositAmountAInWadDecimals = depositAmountAFromDex.mul(multiplierA);

        const priceXA = wadDiv(depositAmountAInWadDecimals.toString(), depositAmountXInWadDecimals.toString()).toString();
        exchangeXArate = BigNumber.from(priceXA).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenX, testTokenA, exchangeXArate);

        const toSwapAmountA = wadMul(depositAmountAFromDex.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const borrowAmountInB = await getAmountsOut(dex1, toSwapAmountA, [testTokenA.address, testTokenB.address]);
        const toSwapAmountAInWadDecimals = BigNumber.from(toSwapAmountA).mul(multiplierA);
        const borrowAmountInBInWadDecimals = borrowAmountInB.mul(multiplierB);
        const priceAB = BigNumber.from(wadDiv(toSwapAmountAInWadDecimals.toString(), borrowAmountInBInWadDecimals.toString()).toString());
        exchangeABrate = priceAB.div(multiplierA);
        const price0 = BigNumber.from(wadDiv(borrowAmountInBInWadDecimals.toString(), toSwapAmountAInWadDecimals.toString()).toString());

        await setOraclePrice(testTokenA, testTokenB, price0.div(USD_MULTIPLIER));

        const liquidationPrice = await primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucketAddress,
          testTokenB.address,
          exchangeABrate,
          leverage,
        );

        slPrice = liquidationPrice.add(1).mul(multiplierA);
        tpPrice = exchangeABrate.add(1).mul(multiplierA);

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeABrate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          isProtocolFeeInPmx: false,
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        });

        orderId = await limitOrderManager.ordersId();

        await PMXToken.transfer(trader.address, parseEther("1"));
        await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
        await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));

        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          isProtocolFeeInPmx: true,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeABrate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        });

        orderWithFeeInPmxId = await limitOrderManager.ordersId();

        defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, depositInThirdAssetMegaRoutes);
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
        await setBadOraclePrice(testTokenA, testTokenB);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenA-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

        await setBadOraclePrice(testTokenA, testTokenB, differentPrice);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

      it("Should revert when firstAssetMegaRoutes summ of shares is 0", async function () {
        const additionalParams = getLimitPriceAdditionalParams(
          [
            {
              shares: 1,
              routes: [
                {
                  to: testTokenA.address,
                  paths: [
                    {
                      dexName: dex1,
                      shares: BigNumber.from(0),
                      payload: await getEncodedPath([testTokenA.address, testTokenB.address], dex1),
                    },
                  ],
                },
              ],
            },
          ],
          depositInThirdAssetMegaRoutes,
        );

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: additionalParams,
            firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex1, [], 0),
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should revert when depositInThirdAssetMegaRoutes summ of shares is 0", async function () {
        const additionalParams = getLimitPriceAdditionalParams(firstAssetMegaRoutes, [
          {
            shares: 1,
            routes: [
              {
                to: testTokenA.address,
                paths: [
                  {
                    dexName: dex1,
                    shares: BigNumber.from(0),
                    payload: await getEncodedPath([testTokenX.address, testTokenB.address], dex1),
                  },
                ],
              },
            ],
          },
        ]);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: additionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: await getSingleMegaRoute([testTokenX.address, testTokenB.address], dex1, [], 0),
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      });

      it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        await setBadOraclePrice(testTokenX, testTokenB);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

      it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%(oracle tokenX-tokenB)", async function () {
        const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenX.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
        await setBadOraclePrice(testTokenX, testTokenB, differentPrice);

        await expect(
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

      it("Should be openPositionByOrder by oracle price if dex price is more than the oracle price by DefaultOracleTolerableLimit + 5%(oracle tokenX-tokenA)", async function () {
        await setBadOraclePrice(testTokenX, testTokenA);

        const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const depositAmountA = wadMul(depositAmountX.toString(), rate.toString()).toString();
        const depositAmountAInADecimals = BigNumber.from(depositAmountA).div(multiplierA);
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
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
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenX.address, testTokenB.address, differentPrice],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
        await setBadOraclePrice(testTokenX, testTokenA, differentPrice);

        const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const depositAmountA = wadMul(depositAmountX.toString(), rate.toString()).toString();
        const depositAmountAInADecimals = BigNumber.from(depositAmountA).div(multiplierA);
        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
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
        const slPrice = 0;
        const tpPrice = 0;
        await limitOrderManager.connect(trader).createLimitOrder({
          bucket: "bucket1",
          depositAsset: testTokenX.address,
          depositAmount: depositAmountX,
          positionAsset: testTokenB.address,
          deadline: deadline,
          takeDepositFromWallet: takeDepositFromWallet,
          leverage: leverage,
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeABrate))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenX),
        });
        const orderId = await limitOrderManager.ordersId();

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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
        const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const depositAmountA = wadMul(depositAmountX.toString(), rate.toString()).toString();

        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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
            wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString())
              .multipliedBy(NegativeOne.toString())
              .toString(),
          ],
        );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      });

      it("Should create position by order when dex amountOut < oracle amountOut, increase traders count, add traderPositions and then delete the order", async function () {
        const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const depositAmountA = wadMul(depositAmountX.toString(), rate.toString()).toString();
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const depositAmountInBDecimals = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const positionAmount = amount0Out.add(depositAmountInBDecimals);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const amountOutAfterFee = positionAmount.sub(feeInPositionAsset);

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.be.equal(1);
        const position = await positionManager.getPosition(0);
        const borrowedAmount = wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(depositAmountA);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amountOutAfterFee);
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should create position by order when dex amountOut > oracle amountOut, increase traders count, add traderPositions and then delete the order", async function () {
        // making the oracle price worse than the dex price
        const newPrice = wadDiv(exchangeXArate.toString(), BigNumber.from(WAD).sub(parseEther("0.05")).toString()).toString();
        await setOraclePrice(testTokenX, testTokenA, newPrice);
        const priceFromOracle = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        let amountOutFromOracle = wadMul(depositAmountX.mul(multiplierX).toString(), priceFromOracle.toString());
        amountOutFromOracle = BigNumber.from(amountOutFromOracle.toString()).div(multiplierA);
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(amountOutFromOracle.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const depositAmountInBDecimals = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const positionAmount = amount0Out.add(depositAmountInBDecimals);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );
        const amountOutAfterFee = positionAmount.sub(feeInPositionAsset);

        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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
        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
        const position = await positionManager.getPosition(0);
        const borrowedAmount = wadMul(amountOutFromOracle.toString(), leverage.sub(parseEther("1")).toString()).toString();
        const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
        expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
        expect(position.depositAmountInSoldAsset).to.equal(amountOutFromOracle);
        expect(position.bucket).to.equal(bucket.address);
        expect(position.positionAsset).to.equal(testTokenB.address);
        expect(position.positionAmount).to.equal(amountOutAfterFee);
        expect(position.trader).to.equal(trader.address);
        expect(position.openBorrowIndex).to.equal(borrowIndex);
        // order has been deleted
        expect(await limitOrderManager.orderIndexes(orderId)).to.be.equal(0);
      });

      it("Should open position by order and do not lock trader deposit amount from dex in traderBalanceVault", async function () {
        const { lockedBalance: lockedBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const { lockedBalance: lockedBalanceTraderAbefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const depositAmountA = wadMul(depositAmountX.toString(), rate.toString()).toString();
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const depositAmountInBDecimals = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const positionAmount = amount0Out.add(depositAmountInBDecimals);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
          FeeRateType.MarginLimitOrderExecuted,
          0,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        );

        await expect(() =>
          limitOrderManager.connect(liquidator).openPositionByOrder({
            orderId: orderId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
            positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
            nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
            nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
            pullOracleData: [],
          }),
        ).to.changeTokenBalances(testTokenB, [traderBalanceVault, Treasury], [0, feeInPositionAsset]);

        const { lockedBalance: lockedBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const { lockedBalance: lockedBalanceTraderAafter } = await traderBalanceVault.balances(trader.address, testTokenA.address);

        expect(lockedBalanceTraderBbefore.sub(lockedBalanceTraderBafter)).to.equal(depositAmountX);
        expect(lockedBalanceTraderAafter.sub(lockedBalanceTraderAbefore)).to.equal(0);
      });

      it("Should open position when isProtocolFeeInPmx=true", async function () {
        const { lockedBalance: lockedBalanceTraderBbefore } = await traderBalanceVault.balances(trader.address, testTokenX.address);
        const rate = await getExchangeRateByRoutes(testTokenX, await getEncodedChainlinkRouteViaUsd(testTokenA));
        const depositAmountA = wadMul(depositAmountX.toString(), rate.toString()).toString();
        const amount0Out = await getAmountsOut(
          dex1,
          wadMul(depositAmountA.toString(), leverage.sub(parseEther("1")).toString()).toString(),
          [testTokenA.address, testTokenB.address],
        );
        const depositAmountInBDecimals = await getAmountsOut(dex1, depositAmountX, [testTokenX.address, testTokenB.address]);
        const positionAmount = amount0Out.add(depositAmountInBDecimals);
        const feeInPositionAsset = await calculateFeeInPositionAsset(
          testTokenB.address,
          positionAmount,
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
            orderId: orderWithFeeInPmxId,
            conditionIndex: 0,
            comAdditionalParams: defaultAdditionalParams,
            firstAssetMegaRoutes: firstAssetMegaRoutes,
            depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
            keeper: liquidator.address,
            firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
            thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
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

        const { lockedBalance: lockedBalanceTraderBafter } = await traderBalanceVault.balances(trader.address, testTokenX.address);

        expect(lockedBalanceTraderBbefore.sub(lockedBalanceTraderBafter)).to.equal(depositAmountX);
      });

      it("Should open position by order and do not lock trader deposit amount traderBalanceVault", async function () {
        const { lockedBalance: lockedBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        await limitOrderManager.connect(liquidator).openPositionByOrder({
          orderId: orderId,
          conditionIndex: 0,
          comAdditionalParams: defaultAdditionalParams,
          firstAssetMegaRoutes: firstAssetMegaRoutes,
          depositInThirdAssetMegaRoutes: depositInThirdAssetMegaRoutes,
          keeper: liquidator.address,
          firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
          positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd(ethAddress),
          nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
          positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
          nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
          pullOracleData: [],
        });
        const { lockedBalance: lockedAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
        expect(lockedBefore).to.equal(lockedAfter);
      });
    });
  });
});
