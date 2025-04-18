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
    BigNumber,
    constants: { MaxUint256, HashZero, AddressZero, Zero },
  },
  deployments: { fixture },
} = require("hardhat");

const { wadDiv } = require("./utils/math");
const {
  getAmountsOut,
  getAmountsIn,
  addLiquidity,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  getEncodedPath,
  getSingleMegaRoute,
} = require("./utils/dexOperations");
const { parseArguments } = require("./utils/eventValidation");
const {
  deployMockPositionManager,
  deployMockLimitOrderManager,
  deployMockPrimexDNS,
  deployMockDexAdapter,
} = require("./utils/waffleMocks");
const { MAX_TOKEN_DECIMALITY, TAKE_PROFIT_STOP_LOSS_CM_TYPE, NATIVE_CURRENCY, USD_DECIMALS, USD_MULTIPLIER } = require("./utils/constants");
const { getTakeProfitStopLossParams, getCondition } = require("./utils/conditionParams");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("./utils/oracleUtils");

process.env.TEST = true;

describe("BestDexLens", function () {
  let positionManager,
    limitOrderManager,
    traderBalanceVault,
    bucket,
    BestDexLens,
    PrimexDNS,
    dexAdapter,
    ErrorsLibrary,
    snapshotId,
    depositAmountA,
    depositAmountB,
    depositAmountX,
    dexesWithAncillaryData,
    availableDexes,
    primexPricingLibrary,
    primexPricingLibraryMock,
    primexLens;
  let ancillaryDexDataDex, ancillaryDexDataDex2;
  let trader, lender, deployer;
  let dex, dex2, dexUni3, dexRouter, dex2Router;
  let testTokenA, testTokenB, testTokenX;
  let decimalsA, decimalsB, decimalsX;
  let multiplierA, multiplierB, multiplierX;
  let borrowedAmount0, borrowedAmount1, borrowedAmount2;
  let positionAmount2;
  let positionsStopLoss, positionsTakeProfit;
  let dexExchangeRateTtaTtb;
  let mockLimitOrderManager, mockPositionManager;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    positionManager = await getContract("PositionManager");
    limitOrderManager = await getContract("LimitOrderManager");
    traderBalanceVault = await getContract("TraderBalanceVault");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    BestDexLens = await getContract("BestDexLens");
    dexAdapter = await getContract("DexAdapter");
    ErrorsLibrary = await getContract("Errors");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    primexLens = await getContract("PrimexLens");

    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();

    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([lender.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    decimalsX = await testTokenX.decimals();

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }
    dexUni3 = "uniswapv3";
    dexRouter = await PrimexDNS.getDexAddress(dex);
    dex2Router = await PrimexDNS.getDexAddress(dex2);

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    checkIsDexSupported(dex);
    ancillaryDexDataDex = await getAncillaryDexData({ dex });
    ancillaryDexDataDex2 = await getAncillaryDexData({ dex: dex2 });
    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenX });

    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
    await addLiquidity({ dex: dexUni3, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    await testTokenB.mint(trader.address, parseUnits("100", decimalsB));
    await testTokenX.mint(trader.address, parseUnits("100", decimalsX));

    const priceOracle = await getContract("PriceOracle");
    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH
    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    const lenderAmount = parseUnits("100", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    depositAmountA = parseUnits("15", decimalsA);
    depositAmountB = parseUnits("15", decimalsB);
    depositAmountX = parseUnits("15", decimalsX);

    const borrowedAmount = parseUnits("25", decimalsA);
    borrowedAmount0 = borrowedAmount.div(5);
    borrowedAmount1 = borrowedAmount.div(5).mul(2);
    borrowedAmount2 = borrowedAmount.div(5).mul(3);

    positionsStopLoss = [parseEther("1").toString(), parseEther("2").toString(), parseEther("3").toString()];
    positionsTakeProfit = [parseEther("6").toString(), parseEther("5").toString(), parseEther("4").toString()];

    const amountOutMin = 0;
    const deadline = new Date().getTime() + 600;
    const takeDepositFromWallet = false;

    /// POSITION 1 /////
    const swapSize = depositAmountA.add(borrowedAmount0);
    const swap = swapSize.mul(multiplierA);
    const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountBinWAD = amountBOut.mul(multiplierB);

    const exchRate = wadDiv(amountBinWAD.toString(), swap.toString()).toString();
    const price = BigNumber.from(exchRate).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price);

    await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmountA);
    await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmountA);
    await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: parseEther("1") });
    await positionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount0,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
      depositAsset: testTokenA.address,
      depositAmount: depositAmountA,
      positionAsset: testTokenB.address,
      amountOutMin: amountOutMin,
      deadline: deadline,
      takeDepositFromWallet: takeDepositFromWallet,
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[0], positionsStopLoss[0])),
      ],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });

    /// POSITION 2 /////
    const amountBOut1 = await getAmountsOut(dex, borrowedAmount1, [testTokenA.address, testTokenB.address]);
    const amountBinWAD1 = amountBOut1.mul(multiplierB);

    const exchRate1 = wadDiv(amountBinWAD1.toString(), borrowedAmount1.mul(multiplierA).toString()).toString();
    const price1 = BigNumber.from(exchRate1).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price1);

    await testTokenB.connect(trader).approve(traderBalanceVault.address, depositAmountB.add(parseUnits("1", decimalsB)));
    await traderBalanceVault.connect(trader).deposit(testTokenB.address, depositAmountB.add(parseUnits("1", decimalsB)));

    await positionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount1,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
      depositAsset: testTokenB.address,
      depositAmount: depositAmountB,
      positionAsset: testTokenB.address,
      amountOutMin: amountOutMin,
      deadline: deadline,
      takeDepositFromWallet: takeDepositFromWallet,
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[1], positionsStopLoss[1])),
      ],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });

    /// POSITION 3 /////
    const amountBOut2 = await getAmountsOut(dex, borrowedAmount2, [testTokenA.address, testTokenB.address]);
    const amountBinWAD2 = amountBOut2.mul(multiplierB);
    const exchRate2 = wadDiv(amountBinWAD2.toString(), borrowedAmount2.mul(multiplierA).toString()).toString();
    const price2 = BigNumber.from(exchRate2).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price2);

    const depositAmountAXFromDex = await getAmountsOut(dex, depositAmountX, [testTokenX.address, testTokenA.address]);
    const amountAFromX = depositAmountAXFromDex.mul(multiplierA);
    const depositX = depositAmountX.mul(multiplierX);
    const exchangeXArate = wadDiv(depositX.toString(), amountAFromX.toString()).toString();
    const priceTTXTTA = BigNumber.from(exchangeXArate).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenX, testTokenA, priceTTXTTA);
    await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
    await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);
    await positionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount2,
        depositInThirdAssetMegaRoutes: await getSingleMegaRoute([testTokenX.address, testTokenB.address], dex),
      },
      firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
      depositAsset: testTokenX.address,
      depositAmount: depositAmountX,
      positionAsset: testTokenB.address,
      amountOutMin: amountOutMin,
      deadline: deadline,
      takeDepositFromWallet: takeDepositFromWallet,
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[2], positionsStopLoss[2])),
      ],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      depositSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    });

    const { positionsData } = await primexLens.getArrayOpenPositionDataByTrader(positionManager.address, trader.address, 0, 10);
    positionAmount2 = positionsData[2].positionSize;

    const amount0Out2 = await getAmountsOut(dex, positionAmount2, [testTokenB.address, testTokenA.address]);
    const amountA = amount0Out2.mul(multiplierA);

    const amountB = positionAmount2.mul(multiplierB);
    dexExchangeRateTtaTtb = wadDiv(amountB.toString(), amountA.toString()).toString();
    const priceTtaTtb = BigNumber.from(dexExchangeRateTtaTtb).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, priceTtaTtb);

    await swapExactTokensForTokens({
      dex: dex2,
      amountIn: parseUnits("70", decimalsA).toString(),
      path: [testTokenA.address, testTokenB.address],
    });

    dexesWithAncillaryData = [
      {
        dex: dex,
        ancillaryData: ancillaryDexDataDex,
      },
      {
        dex: dex2,
        ancillaryData: ancillaryDexDataDex2,
      },
    ];

    mockPositionManager = await deployMockPositionManager(deployer);
    mockLimitOrderManager = await deployMockLimitOrderManager(deployer);

    availableDexes = [
      ["uniswap", HashZero],
      ["sushiswap", HashZero],
      ["curve", HashZero],
      ["uniswapv3", await getAncillaryDexData({ dex: "uniswapv3" })],
      ["quickswapv3", HashZero],
      ["meshswap", HashZero],
    ];
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

  describe("getBestMultipleDexes", function () {
    const amountToSellDefault = 100;
    const sharesDefault = 2;

    async function getSumAmountsFromDexes(amount, numShares, paths) {
      let result = Zero;
      for (let i = 0; i < paths.length; i++) {
        const amountPart = amount.mul(paths[i].shares.toNumber()).div(numShares);
        result = result.add(await getAmountsOut(paths[i].dexName, amountPart, [testTokenB.address, testTokenA.address]));
      }
      return result;
    }

    it("should getBestMultipleDexes when the amount to sell and shares are equal", async function () {
      const amountToSell = 5;
      const shares = 5;

      await swapExactTokensForTokens({
        dex: dex2,
        // The smaller the tokenA decimals,the larger the amount we swap
        amountIn: parseUnits(multiplierA.toString(), decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amountToSell,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.estimateGasAmount).to.equal(await dexAdapter.getGas(dex2Router));
      expect(response.returnAmount).to.equal(await getAmountsOut(dex2, amountToSell, [testTokenB.address, testTokenA.address]));
      const encodedPath = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[1][0]);

      const expectedMegaRoutes = [
        {
          shares: 1,
          routes: [
            {
              to: testTokenA.address,
              paths: [
                {
                  dexName: availableDexes[1][0],
                  shares: BigNumber.from(shares),
                  payload: encodedPath,
                },
              ],
            },
          ],
        },
      ];
      parseArguments(response.megaRoutes, expectedMegaRoutes);
    });

    it("should getBestMultipleDexes", async function () {
      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits(multiplierA.toString(), decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amountToSellDefault,
        isAmountToBuy: false,
        shares: sharesDefault,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      const encodedPath = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[1][0]);
      const expectedMegaRoutes = [
        {
          shares: 1,
          routes: [
            {
              to: testTokenA.address,
              paths: [
                {
                  dexName: availableDexes[1][0],
                  shares: BigNumber.from(sharesDefault),
                  payload: encodedPath,
                },
              ],
            },
          ],
        },
      ];
      parseArguments(response.megaRoutes, expectedMegaRoutes);
      expect(response.estimateGasAmount).to.equal(await dexAdapter.getGas(dex2Router));
      expect(response.returnAmount).to.equal(await getAmountsOut(dex2, amountToSellDefault, [testTokenB.address, testTokenA.address]));
    });

    it("should getBestMultipleDexes when the isAmountToBuy is true", async function () {
      const amountToBuy = 100;
      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amountToBuy,
        isAmountToBuy: true,
        shares: sharesDefault,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      const encodedPath = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[1][0]);
      const expectedMegaRoutes = [
        {
          shares: 1,
          routes: [
            {
              to: testTokenA.address,
              paths: [
                {
                  dexName: availableDexes[1][0],
                  shares: BigNumber.from(sharesDefault),
                  payload: encodedPath,
                },
              ],
            },
          ],
        },
      ];
      parseArguments(response.megaRoutes, expectedMegaRoutes);
      expect(response.estimateGasAmount).to.equal(await dexAdapter.getGas(dex2Router));
      expect(response.returnAmount).to.equal(await getAmountsIn(dex2, amountToBuy, [testTokenB.address, testTokenA.address]));
    });
    it("should getBestMultipleDexes with equal shares", async function () {
      const amountToSell = parseUnits("10", decimalsB);
      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amountToSell,
        isAmountToBuy: false,
        shares: sharesDefault,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      const encodedPath1 = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[0][0]);
      const encodedPath2 = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[1][0]);
      const expectedMegaRoutes = [
        {
          shares: 1,
          routes: [
            {
              to: testTokenA.address,
              paths: [
                {
                  dexName: availableDexes[0][0],
                  shares: BigNumber.from(sharesDefault / 2),
                  payload: encodedPath1,
                },
                {
                  dexName: availableDexes[1][0],
                  shares: BigNumber.from(sharesDefault / 2),
                  payload: encodedPath2,
                },
              ],
            },
          ],
        },
      ];

      parseArguments(response.megaRoutes, expectedMegaRoutes);

      expect(response.estimateGasAmount).to.equal((await dexAdapter.getGas(dexRouter)).add(await dexAdapter.getGas(dex2Router)));
      expect(response.returnAmount).to.equal(
        (await getAmountsOut(dex2, BigNumber.from(amountToSell).div(2), [testTokenB.address, testTokenA.address])).add(
          await getAmountsOut(dex, BigNumber.from(amountToSell).div(2), [testTokenB.address, testTokenA.address]),
        ),
      );
    });

    it("Should revert getBestMultipleDexes when zero assetToBuy address", async function () {
      await expect(
        BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: AddressZero,
          assetToSell: testTokenB.address,
          amount: amountToSellDefault,
          isAmountToBuy: false,
          shares: sharesDefault,
          gasPriceInCheckedAsset: 0,
          dexes: availableDexes,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_ASSET_ADDRESS");
    });

    it("Should revert getBestMultipleDexes when zero assetToSell address", async function () {
      await expect(
        BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenA.address,
          assetToSell: AddressZero,
          amount: amountToSellDefault,
          isAmountToBuy: false,
          shares: sharesDefault,
          gasPriceInCheckedAsset: 0,
          dexes: availableDexes,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_ASSET_ADDRESS");
    });

    it("Should revert when getBestMultipleDexes when assetToBuy == assetToSell", async function () {
      await expect(
        BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenA.address,
          assetToSell: testTokenA.address,
          amount: amountToSellDefault,
          isAmountToBuy: false,
          shares: sharesDefault,
          gasPriceInCheckedAsset: 0,
          dexes: availableDexes,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ASSETS_SHOULD_BE_DIFFERENT");
    });

    it("Should revert getBestMultipleDexes when shares is 0", async function () {
      await expect(
        BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenA.address,
          assetToSell: testTokenB.address,
          amount: amountToSellDefault,
          isAmountToBuy: false,
          shares: 0,
          gasPriceInCheckedAsset: 0,
          dexes: availableDexes,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_SHARES");
    });

    it("Should revert getBestMultipleDexes when the shares is greater than the amount to sell", async function () {
      const amountToSell = 4;
      const shares = 5;
      await expect(
        BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenA.address,
          assetToSell: testTokenB.address,
          amount: amountToSell,
          isAmountToBuy: false,
          shares: shares,
          gasPriceInCheckedAsset: 0,
          dexes: availableDexes,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SHARES_AMOUNT_IS_GREATER_THAN_AMOUNT_TO_SELL");
    });

    it("should getBestMultipleDexes with the fourth dex", async function () {
      await swapExactTokensForTokens({
        dex: dex2,
        // The smaller the tokenA decimals,the larger the amount we swap
        amountIn: parseUnits(multiplierA.toString(), decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const shares = 20;
      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amountToSellDefault,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      const encodedPath = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[1][0]);
      const expectedMegaRoutes = [
        {
          shares: 1,
          routes: [
            {
              to: testTokenA.address,
              paths: [
                {
                  dexName: availableDexes[1][0],
                  shares: BigNumber.from(shares),
                  payload: encodedPath,
                },
              ],
            },
          ],
        },
      ];
      parseArguments(response.megaRoutes, expectedMegaRoutes);
      expect(response.estimateGasAmount).to.equal(await dexAdapter.getGas(dex2Router));
      expect(response.returnAmount).to.equal(await getAmountsOut(dex2, amountToSellDefault, [testTokenB.address, testTokenA.address]));
    });

    it("should have more amount out than single dex", async function () {
      const amount = parseUnits("1", decimalsB);
      const shares = 10;

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amount,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.returnAmount.gte(await getAmountsOut(dex, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dex2, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dexUni3, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));

      const sumAmountsFromDexes = await getSumAmountsFromDexes(amount, shares, response.megaRoutes[0].routes[0].paths);
      expect(response.returnAmount).to.equal(sumAmountsFromDexes);
    });

    it("should have more amount out than single dex when sushiswap has low price for testTokenB", async function () {
      const amount = parseUnits("1", decimalsB);
      const shares = 10;

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amount,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.returnAmount.gte(await getAmountsOut(dex, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dex2, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dexUni3, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));

      const sumAmountsFromDexes = await getSumAmountsFromDexes(amount, shares, response.megaRoutes[0].routes[0].paths);
      expect(response.returnAmount).to.equal(sumAmountsFromDexes);
    });
    it("Should choose the best dex considering the gas for the swap", async function () {
      const amount = parseUnits("1", decimalsA);
      const nativePriceToTokenB = parseEther("0.3");
      const uniswapv2Router = await PrimexDNS.getDexAddress("uniswap");
      const uniswapv3Router = await PrimexDNS.getDexAddress("uniswapv3");

      const mockPrimexDNS = await deployMockPrimexDNS(deployer);
      const mockDexAdapter = await deployMockDexAdapter(deployer);
      await mockPositionManager.mock.primexDNS.returns(mockPrimexDNS.address);
      await mockPrimexDNS.mock.dexAdapter.returns(mockDexAdapter.address);

      await mockPrimexDNS.mock.getDexAddress.withArgs("uniswap").returns(uniswapv2Router);
      await mockPrimexDNS.mock.getDexAddress.withArgs("uniswapv3").returns(uniswapv3Router);

      await mockDexAdapter.mock.getGas.withArgs(uniswapv2Router).returns(0);
      await mockDexAdapter.mock.getGas.withArgs(uniswapv3Router).returns(0);

      const encodedPathV2 = await getEncodedPath([testTokenA.address, testTokenB.address], "uniswap");
      const encodedPathV3 = await getEncodedPath([testTokenA.address, testTokenB.address], "uniswapv3");

      const GetAmountsParamsV2 = {
        encodedPath: encodedPathV2,
        amount: amount,
        dexRouter: uniswapv2Router,
      };

      const GetAmountsParamsV3 = {
        encodedPath: encodedPathV3,
        amount: amount,
        dexRouter: uniswapv3Router,
      };
      // to make the uniswapv3 the best dex
      await mockDexAdapter.mock.getAmountsOut.withArgs(GetAmountsParamsV2).returns([amount, amount.sub("1"), 0]);
      await mockDexAdapter.mock.getAmountsOut.withArgs(GetAmountsParamsV3).returns([amount, amount.add("10"), 0]);
      await mockDexAdapter.mock.dexType.withArgs(uniswapv2Router).returns(1);
      await mockDexAdapter.mock.dexType.withArgs(uniswapv3Router).returns(2);

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: mockPositionManager.address,
        assetToBuy: testTokenB.address,
        assetToSell: testTokenA.address,
        amount: amount,
        isAmountToBuy: false,
        shares: 1,
        gasPriceInCheckedAsset: nativePriceToTokenB,
        dexes: [
          ["uniswap", HashZero],
          ["uniswapv3", await getAncillaryDexData({ dex: "uniswapv3" })],
        ],
      });
      // check that the uniswapv3 is the best dex
      expect(response.megaRoutes[0].routes[0].paths[0].dexName).to.be.equal("uniswapv3");

      // change the gas amount for uniswapv3
      await mockDexAdapter.mock.getGas.withArgs(uniswapv3Router).returns(10000);

      const response2 = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: mockPositionManager.address,
        assetToBuy: testTokenB.address,
        assetToSell: testTokenA.address,
        amount: amount,
        isAmountToBuy: false,
        shares: 1,
        gasPriceInCheckedAsset: nativePriceToTokenB,
        dexes: [
          ["uniswap", HashZero],
          ["uniswapv3", await getAncillaryDexData({ dex: "uniswapv3" })],
        ],
      });

      // check that the uniswapv3 is not the best considering the gas
      expect(response2.megaRoutes[0].routes[0].paths[0].dexName).to.be.equal("uniswap");
    });
    it("Should return correct returnAmount when gasPriceInCheckedAsset is not zero", async function () {
      const amount = parseUnits("1", decimalsA);
      const nativePriceToTokenB = parseEther("0.3");

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenB.address,
        assetToSell: testTokenA.address,
        amount: amount,
        isAmountToBuy: false,
        shares: 1,
        gasPriceInCheckedAsset: nativePriceToTokenB,
        dexes: [["uniswap", HashZero]],
      });
      const expectedAmount = await getAmountsOut("uniswap", BigNumber.from(amount), [testTokenA.address, testTokenB.address]);
      expect(expectedAmount).to.be.equal(response.returnAmount);
    });
    it("Should return correct returnAmount when gasPriceInCheckedAsset is not zero when isAmountToBuy is true", async function () {
      const amount = parseUnits("1", decimalsB);
      const nativePriceToTokenB = parseEther("0.3");

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenB.address,
        assetToSell: testTokenA.address,
        amount: amount,
        isAmountToBuy: true,
        shares: 1,
        gasPriceInCheckedAsset: nativePriceToTokenB,
        dexes: [["uniswap", HashZero]],
      });

      const expectedAmount = await getAmountsIn("uniswap", BigNumber.from(amount), [testTokenA.address, testTokenB.address]);
      expect(expectedAmount).to.be.equal(response.returnAmount);
    });
    it("should have more amount out than single dex when uniswapv2 has low price for testTokenB", async function () {
      const amount = parseUnits("1", decimalsB);
      const shares = 15;

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amount,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.returnAmount.gte(await getAmountsOut(dex, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dex2, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dexUni3, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));

      const sumAmountsFromDexes = await getSumAmountsFromDexes(amount, shares, response.megaRoutes[0].routes[0].paths);
      expect(response.returnAmount).to.equal(sumAmountsFromDexes);
    });

    it("should have more amount out than single dex when uniswapv3 has low price for testTokenB", async function () {
      const amount = parseUnits("1", decimalsB);
      const shares = 17;

      await swapExactTokensForTokens({
        dex: dexUni3,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amount,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.returnAmount.gte(await getAmountsOut(dex, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dex2, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dexUni3, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));

      const sumAmountsFromDexes = await getSumAmountsFromDexes(amount, shares, response.megaRoutes[0].routes[0].paths);
      expect(response.returnAmount).to.equal(sumAmountsFromDexes);
    });

    it("should getBestMultipleDexes for amounts less than gas fees", async function () {
      const amount = 10;
      const shares = 10;

      for (let i = 0; i < availableDexes.length; i++) {
        try {
          await swapExactTokensForTokens({
            dex: availableDexes[i][0],
            // The smaller the tokenA decimals,the larger the amount we swap
            amountIn: parseUnits(multiplierA.toString(), decimalsA).toString(),
            path: [testTokenA.address, testTokenB.address],
          });
        } catch {}
      }

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amount,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.returnAmount.gte(await getAmountsOut(dex, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dex2, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
      expect(response.returnAmount.gte(await getAmountsOut(dexUni3, BigNumber.from(amount), [testTokenB.address, testTokenA.address])));
    });

    it("should swap all amount on one dex when it has best price", async function () {
      const amount = parseUnits("1", decimalsB);
      const shares = 10;

      await swapExactTokensForTokens({
        dex: dexUni3,
        amountIn: parseUnits("1000", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const response = await BestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: testTokenA.address,
        assetToSell: testTokenB.address,
        amount: amount,
        isAmountToBuy: false,
        shares: shares,
        gasPriceInCheckedAsset: 0,
        dexes: availableDexes,
      });

      expect(response.returnAmount).to.equal(await getAmountsOut(dexUni3, amount, [testTokenB.address, testTokenA.address]));
      const encodedPath = await getEncodedPath([testTokenB.address, testTokenA.address], availableDexes[3][0]);
      const expectedMegaRoutes = [
        {
          shares: 1,
          routes: [
            {
              to: testTokenA.address,
              paths: [
                {
                  dexName: availableDexes[3][0],
                  shares: BigNumber.from(shares),
                  payload: encodedPath,
                },
              ],
            },
          ],
        },
      ];

      parseArguments(response.megaRoutes, expectedMegaRoutes);
    });
  });

  describe("getBestDexByOrder", function () {
    it("should revert when positionManager address not supported", async function () {
      await mockPositionManager.mock.supportsInterface.returns(false);
      await expect(
        BestDexLens.callStatic.getBestDexByOrder([
          mockPositionManager.address,
          limitOrderManager.address,
          0,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("should revert when limitOrderManager address not supported", async function () {
      await mockLimitOrderManager.mock.supportsInterface.returns(false);
      await expect(
        BestDexLens.callStatic.getBestDexByOrder([
          positionManager.address,
          mockLimitOrderManager.address,
          0,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("getBestDexForOpenablePosition", function () {
    it("Should be reverted when one of the shares equal to zero", async function () {
      await expect(
        BestDexLens.callStatic[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          testTokenA.address,
          parseUnits("5", decimalsA),
          testTokenX.address,
          parseUnits("1", decimalsX),
          testTokenB.address,
          { firstAssetShares: 0, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_SHARES");

      await expect(
        BestDexLens.callStatic[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          testTokenA.address,
          parseUnits("5", decimalsA),
          testTokenX.address,
          parseUnits("1", decimalsX),
          testTokenB.address,
          { firstAssetShares: 1, depositInThirdAssetShares: 0, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_SHARES");

      await expect(
        BestDexLens.callStatic[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          testTokenA.address,
          parseUnits("5", decimalsA),
          testTokenX.address,
          parseUnits("1", decimalsX),
          testTokenB.address,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 0 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_SHARES");
    });
    it("Should be reverted when one of the addresses params is equal to zero", async function () {
      await expect(
        BestDexLens[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          AddressZero,
          parseUnits("5", decimalsA),
          testTokenX.address,
          parseUnits("1", decimalsX),
          testTokenB.address,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      await expect(
        BestDexLens[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          testTokenA.address,
          parseUnits("5", decimalsA),
          AddressZero,
          parseUnits("1", decimalsX),
          testTokenB.address,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      await expect(
        BestDexLens[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          testTokenA.address,
          parseUnits("5", decimalsA),
          testTokenX.address,
          parseUnits("1", decimalsX),
          AddressZero,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should be reverted when depositAmount is equal to zero", async function () {
      await expect(
        BestDexLens[
          "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
        ]([
          positionManager.address,
          testTokenA.address,
          parseUnits("5", decimalsA),
          testTokenX.address,
          0,
          testTokenB.address,
          { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
          dexesWithAncillaryData,
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSITED_AMOUNT_IS_0");
    });
    it("getBestDexForOpenablePosition return the correct values when deposit in the third asset", async function () {
      const expectedValues = {
        _firstAssetReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenB.address,
          assetToSell: testTokenA.address,
          amount: parseUnits("5", decimalsA),
          isAmountToBuy: false,
          shares: 1,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
        _depositInThirdAssetReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenB.address,
          assetToSell: testTokenX.address,
          amount: parseUnits("1", decimalsX),
          isAmountToBuy: false,
          shares: 1,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
        _depositToBorrowedReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenA.address,
          assetToSell: testTokenX.address,
          amount: parseUnits("1", decimalsX),
          isAmountToBuy: false,
          shares: 1,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
      };

      const values = await BestDexLens.callStatic[
        "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
      ]([
        positionManager.address,
        testTokenA.address,
        parseUnits("5", decimalsA),
        testTokenX.address,
        parseUnits("1", decimalsX),
        testTokenB.address,
        { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
        dexesWithAncillaryData,
      ]);
      parseArguments(expectedValues, values);
    });
    it("getBestDexForOpenablePosition return the correct values when deposit in the borrowed asset", async function () {
      const expectedValues = {
        _firstAssetReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenB.address,
          assetToSell: testTokenA.address,
          amount: parseUnits("6", decimalsA),
          isAmountToBuy: false,
          shares: 1,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
        _depositInThirdAssetReturnParams: {
          returnAmount: 0,
          estimateGasAmount: 0,
          megaRoutes: [],
        },
        _depositToBorrowedReturnParams: {
          returnAmount: 0,
          estimateGasAmount: 0,
          megaRoutes: [],
        },
      };

      const values = await BestDexLens.callStatic[
        "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
      ]([
        positionManager.address,
        testTokenA.address,
        parseUnits("5", decimalsA),
        testTokenA.address,
        parseUnits("1", decimalsA),
        testTokenB.address,
        { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
        dexesWithAncillaryData,
      ]);
      parseArguments(expectedValues, values);
    });

    it("getBestDexForOpenablePosition return the correct values when deposit in the position asset", async function () {
      const expectedValues = {
        _firstAssetReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenB.address,
          assetToSell: testTokenA.address,
          amount: parseUnits("6", decimalsA),
          isAmountToBuy: false,
          shares: 1,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
        _depositInThirdAssetReturnParams: {
          returnAmount: 0,
          estimateGasAmount: 0,
          megaRoutes: [],
        },
        _depositToBorrowedReturnParams: {
          returnAmount: 0,
          estimateGasAmount: 0,
          megaRoutes: [],
        },
      };

      const values = await BestDexLens.callStatic[
        "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
      ]([
        positionManager.address,
        testTokenA.address,
        parseUnits("5", decimalsA),
        testTokenA.address,
        parseUnits("1", decimalsA),
        testTokenB.address,
        { firstAssetShares: 1, depositInThirdAssetShares: 0, depositToBorrowedShares: 1 },
        dexesWithAncillaryData,
      ]);
      parseArguments(expectedValues, values);
    });
    it("getBestDexForOpenablePosition return the correct values when multiple dexes", async function () {
      const expectedValues = {
        _firstAssetReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenB.address,
          assetToSell: testTokenA.address,
          amount: parseUnits("5", decimalsA),
          isAmountToBuy: false,
          shares: 2,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
        _depositInThirdAssetReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenB.address,
          assetToSell: testTokenX.address,
          amount: parseUnits("1", decimalsX),
          isAmountToBuy: false,
          shares: 2,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
        _depositToBorrowedReturnParams: await BestDexLens.callStatic.getBestMultipleDexes({
          positionManager: positionManager.address,
          assetToBuy: testTokenA.address,
          assetToSell: testTokenX.address,
          amount: parseUnits("1", decimalsX),
          isAmountToBuy: false,
          shares: 2,
          gasPriceInCheckedAsset: 0,
          dexes: dexesWithAncillaryData,
        }),
      };

      const values = await BestDexLens.callStatic[
        "getBestDexForOpenablePosition((address,address,uint256,address,uint256,address,(uint256,uint256,uint256),(string,bytes32)[]))"
      ]([
        positionManager.address,
        testTokenA.address,
        parseUnits("5", decimalsA),
        testTokenX.address,
        parseUnits("1", decimalsX),
        testTokenB.address,
        { firstAssetShares: 2, depositInThirdAssetShares: 2, depositToBorrowedShares: 2 },
        dexesWithAncillaryData,
      ]);
      parseArguments(expectedValues, values);
    });
    it("Should be revert when shares is zero", async function () {
      await expect(
        BestDexLens.callStatic.getBestDexByPosition(positionManager.address, 0, 0, dexesWithAncillaryData),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_SHARES");
    });
  });
});
