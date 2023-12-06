// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    BigNumber,
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits, defaultAbiCoder },
    constants: { MaxUint256, AddressZero },
  },
  deployments: { fixture },
} = require("hardhat");

const { wadDiv, rayDiv, wadMul, rayMul } = require("./utils/math");
const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  OrderType,
  NATIVE_CURRENCY,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
} = require("./utils/constants");
const {
  getAmountsOut,
  addLiquidity,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  getSingleRoute,
} = require("./utils/dexOperations");
const { parseArguments } = require("./utils/eventValidation");
const { getLimitPriceParams, getTakeProfitStopLossParams, getCondition } = require("./utils/conditionParams");
const { barCalcParams } = require("./utils/defaultBarCalcParams");
const { deployMockInterestRateStrategy, deployMockWhiteBlackList } = require("./utils/waffleMocks");

process.env.TEST = true;

async function getTokenMetadata(tokenAddress, trader) {
  const token = await getContractAt("ERC20", tokenAddress);
  const tokenMetadata = {
    tokenAddress: tokenAddress,
    symbol: await token.symbol(),
    name: await token.name(),
    decimals: await token.decimals(),
    balance: trader ? await token.balanceOf(trader.address) : 0,
  };
  return tokenMetadata;
}

async function getBucketMetaData(bucketAddress, trader) {
  const bucket = await getContractAt("Bucket", bucketAddress);
  const DebtToken = await getContractAt("DebtToken", await bucket.debtToken());
  const PToken = await getContractAt("PToken", await bucket.pToken());
  const priceOracle = await getContract("PriceOracle");

  const demand = await DebtToken.totalSupply();
  const availableLiquidity = await bucket.availableLiquidity();

  const supportedTokens = [];
  const assetsCount = (await bucket.getAllowedAssets()).length;

  for (let i = 0; i < assetsCount; i++) {
    const asset = (await bucket.getAllowedAssets())[i];
    let assetParams = await bucket.allowedAssets(asset);
    assetParams = {
      index: assetParams.index,
      isSupported: assetParams.isSupported,
      pairPriceDrop: await priceOracle.pairPriceDrops(asset, await bucket.borrowedAsset()),
      maxLeverage: await bucket.maxAssetLeverage(asset),
    };

    const supportedToken = { asset: await getTokenMetadata(asset, trader), properties: assetParams };
    supportedTokens.push(supportedToken);
  }
  const LMparams = await bucket.getLiquidityMiningParams();
  const liquidityMiningRewardDistributor = await LMparams.liquidityMiningRewardDistributor;
  const lenderInfo = {
    amountInMining: 0,
    currentPercent: 0,
    rewardsInPMX: [0, 0, 0],
  };
  const lmBucketInfo = {
    pmxAmount: 0,
    withdrawnRewards: 0,
    totalPoints: 0,
  };

  const interestRateStrategy = await getContractAt("InterestRateStrategy", await bucket.interestRateStrategy());
  const barCalcParams = await interestRateStrategy.getBarCalculationParams(bucket.address);
  const bucketMetaData = {
    bucketAddress: bucketAddress,
    name: "bucket1",
    asset: await getTokenMetadata(await bucket.borrowedAsset(), trader),
    BAR: await bucket.bar(),
    LAR: await bucket.lar(),
    supply: demand.add(availableLiquidity),
    demand: demand,
    availableLiquidity: availableLiquidity,
    utilizationRatio: rayDiv(demand.toString(), demand.add(availableLiquidity).toString()).toString(),
    supportedAssets: supportedTokens,
    pToken: await getTokenMetadata(PToken.address, trader),
    debtToken: await getTokenMetadata(DebtToken.address, trader),
    feeBuffer: await bucket.feeBuffer(),
    withdrawalFeeRate: await bucket.withdrawalFeeRate(),
    miningParams: LMparams,
    lenderInfo:
      liquidityMiningRewardDistributor !== AddressZero
        ? await liquidityMiningRewardDistributor.getLenderInfo("bucket1", trader.address)
        : lenderInfo,
    lmBucketInfo:
      liquidityMiningRewardDistributor !== AddressZero ? await liquidityMiningRewardDistributor.getBucketInfo("bucket1") : lmBucketInfo,
    estimatedBar: await bucket.estimatedBar(),
    estimatedLar: await bucket.estimatedLar(),
    isDeprecated: await bucket.isDeprecated(),
    isDelisted: await bucket.isDelisted(),
    barCalcParams: barCalcParams,
    maxTotalDeposit: await bucket.maxTotalDeposit(),
  };
  return bucketMetaData;
}
describe("PrimexLens", function () {
  let priceFeed,
    priceFeedTTBUSD,
    positionManager,
    priceOracle,
    limitOrderManager,
    traderBalanceVault,
    bucket,
    PrimexLens,
    BestDexLens,
    PrimexDNS,
    snapshotId,
    protocolRate,
    limitOrderProtocolRateInPmx,
    depositAmountA,
    depositAmountB,
    depositAmountX,
    depositAmountAFromB,
    depositAmountAFromX,
    dexesWithAncillaryData,
    firstAssetRoutes,
    depositInThirdAssetRoutes,
    ErrorsLibrary,
    primexPricingLibrary;
  let ancillaryDexDataDex, ancillaryDexDataDex2;
  let trader, lender, deployer;
  let dex, dex2;
  let testTokenA, decimalsA, testTokenB, decimalsB, testTokenX, decimalsX, tokenUSD, decimalsUSD, ttaPriceInPMX, PMXToken;
  let borrowedAmount0, borrowedAmount1, borrowedAmount2;
  let positionDebt0, positionDebt1, positionDebt2;
  let positionAmount0, positionAmount1, positionAmount2;
  let bestShares2;
  let positionsStopLoss, positionsTakeProfit;
  let dexExchangeRateTtaTtb;
  let multiplierA, multiplierB;
  let emptyBucketMetaData;
  let PriceInETH;
  const timestamps = [];
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");
    limitOrderManager = await getContract("LimitOrderManager");
    traderBalanceVault = await getContract("TraderBalanceVault");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    tokenUSD = await getContract("USD Coin");
    PMXToken = await getContract("EPMXToken");
    decimalsUSD = await tokenUSD.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    PrimexLens = await getContract("PrimexLens");
    BestDexLens = await getContract("BestDexLens");
    ErrorsLibrary = await getContract("Errors");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

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

    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    const multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

    const tokenMetadata = {
      tokenAddress: AddressZero,
      symbol: "",
      name: "",
      decimals: 0,
      balance: 0,
    };
    const miningParams = {
      liquidityMiningRewardDistributor: AddressZero,
      isBucketLaunched: false,
      accumulatingAmount: 0,
      deadlineTimestamp: 0,
      stabilizationDuration: 0,
      stabilizationEndTimestamp: 0,
      maxAmountPerUser: 0,
      maxDuration: 0,
      maxStabilizationEndTimestamp: 0,
    };
    const lenderInfo = {
      amountInMining: 0,
      currentPercent: 0,
      rewardsInPMX: [0, 0, 0],
    };
    const lmBucketInfo = {
      pmxAmount: 0,
      withdrawnRewards: 0,
      totalPoints: 0,
    };

    const emptyBarCalcParams = {
      urOptimal: 0,
      k0: 0,
      k1: 0,
      b0: 0,
      b1: 0,
    };
    emptyBucketMetaData = {
      bucketAddress: AddressZero,
      name: "",
      asset: tokenMetadata,
      BAR: 0,
      LAR: 0,
      supply: 0,
      demand: 0,
      availableLiquidity: 0,
      utilizationRatio: 0,
      supportedAssets: [],
      pToken: tokenMetadata,
      debtToken: tokenMetadata,
      feeBuffer: 0,
      withdrawalFeeRate: 0,
      miningParams: miningParams,
      lenderInfo: lenderInfo,
      lmBucketInfo: lmBucketInfo,
      estimatedBar: 0,
      estimatedLar: 0,
      isDeprecated: false,
      isDelisted: false,
      barCalcParams: emptyBarCalcParams,
      maxTotalDeposit: 0,
    };

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }

    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
    depositInThirdAssetRoutes = await getSingleRoute([testTokenX.address, testTokenB.address], dex);
    checkIsDexSupported(dex);
    ancillaryDexDataDex = await getAncillaryDexData({ dex });
    ancillaryDexDataDex2 = await getAncillaryDexData({ dex: dex2 });
    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenX });

    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenX });

    await testTokenA.mint(trader.address, parseUnits("1000", decimalsA));
    await testTokenB.mint(trader.address, parseUnits("1000", decimalsB));
    await testTokenX.mint(trader.address, parseUnits("1000", decimalsX));

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTXTTB = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTB", deployer.address);
    const priceFeedTTXTTA = await PrimexAggregatorV3TestServiceFactory.deploy("PrimexAggregatorV3TestService TTX_TTA", deployer.address);
    priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_USD", deployer.address);

    await priceFeedTTBUSD.setAnswer(parseUnits("10000", decimalsUSD));
    await priceFeedTTBUSD.setDecimals(decimalsUSD);

    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    const priceFeedTTBETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_ETH", deployer.address);
    const priceFeedTTXETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTX_ETH", deployer.address);
    const priceFeedTTAPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_PMX", deployer.address);

    const decimalsPMX = await PMXToken.decimals();
    await priceFeedTTAPMX.setDecimals(decimalsPMX);
    ttaPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 tta=0.2 pmx
    await priceFeedTTAPMX.setAnswer(ttaPriceInPMX);

    PriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(PriceInETH);
    await priceFeedTTBETH.setDecimals("18");
    await priceFeedTTBETH.setAnswer(PriceInETH);
    await priceFeedTTXETH.setDecimals("18");
    await priceFeedTTXETH.setAnswer(PriceInETH);

    await priceOracle.updatePriceFeed(testTokenA.address, PMXToken.address, priceFeedTTAPMX.address);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, await priceOracle.eth(), priceFeedTTBETH.address);
    await priceOracle.updatePriceFeed(testTokenX.address, await priceOracle.eth(), priceFeedTTXETH.address);
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenX.address, testTokenB.address, priceFeedTTXTTB.address);
    await priceOracle.updatePriceFeed(testTokenX.address, testTokenA.address, priceFeedTTXTTA.address);
    await priceOracle.updatePriceFeed(testTokenB.address, tokenUSD.address, priceFeedTTBUSD.address);

    // need to calculate minFee and maxFee from native to PMX
    const priceFeedETHPMX = await PrimexAggregatorV3TestServiceFactory.deploy("ETH_PMX", deployer.address);
    // 1 tta=0.2 pmx; 1 tta=0.3 eth -> 1 eth = 0.2/0.3 pmx
    await priceFeedETHPMX.setAnswer(parseUnits("0.666666666666666666", 18));
    await priceFeedETHPMX.setDecimals(decimalsPMX);
    await priceOracle.updatePriceFeed(await priceOracle.eth(), PMXToken.address, priceFeedETHPMX.address);

    const lenderAmountA = parseUnits("1000", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmountA, true);

    depositAmountA = parseUnits("15", decimalsA);
    depositAmountB = parseUnits("15", decimalsB);
    depositAmountX = parseUnits("15", decimalsX);

    const borrowedAmount = parseUnits("25", decimalsA);
    borrowedAmount0 = borrowedAmount.div(5);
    borrowedAmount1 = borrowedAmount.div(5).mul(2);
    borrowedAmount2 = borrowedAmount.div(5).mul(3);

    protocolRate = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY);
    limitOrderProtocolRateInPmx = await PrimexDNS.feeRates(OrderType.LIMIT_ORDER, PMXToken.address);

    positionsStopLoss = [parseEther("1").toString(), parseEther("2").toString(), parseEther("3").toString()];
    positionsTakeProfit = [parseEther("6").toString(), parseEther("5").toString(), parseEther("4").toString()];

    const amountOutMin = 0;
    const deadline = new Date().getTime() + 600;
    const takeDepositFromWallet = false;
    const payFeeFromWallet = false;

    const swapSize = depositAmountA.add(borrowedAmount0);
    const swap = swapSize.mul(multiplierA);
    const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountBinWAD = amountBOut.mul(multiplierB);

    const exchRate = wadDiv(amountBinWAD.toString(), swap.toString()).toString();
    const price = BigNumber.from(exchRate).div(multiplierB);
    await priceFeed.setAnswer(price);
    await priceFeed.setDecimals(decimalsB);

    await priceFeedTTXTTB.setDecimals("18");
    await priceFeedTTXTTB.setAnswer("1");

    await positionManager.setDefaultOracleTolerableLimit(parseEther("0.01"));
    await positionManager.setMaintenanceBuffer(parseEther("0.01"));

    /// ////////////// POSITION 1 ////////////////
    // open first position
    const feeAmountCalculateWithETHRate = wadMul(swapSize.mul(multiplierA).toString(), protocolRate.toString()).toString();
    const feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

    await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmountA);
    await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmountA);
    await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

    await positionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount0,
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: firstAssetRoutes,
      depositAsset: testTokenA.address,
      depositAmount: depositAmountA,
      positionAsset: testTokenB.address,
      amountOutMin: amountOutMin,
      deadline: deadline,
      takeDepositFromWallet: takeDepositFromWallet,
      payFeeFromWallet: payFeeFromWallet,
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[0], positionsStopLoss[0])),
      ],
    });
    timestamps.push((await provider.getBlock("latest")).timestamp);

    /// ////////////// POSITION 2 ////////////////
    const amountBOut1 = await getAmountsOut(dex, borrowedAmount1, [testTokenA.address, testTokenB.address]);
    const amountBinWAD1 = amountBOut1.mul(multiplierB);

    const exchRate1 = wadDiv(amountBinWAD1.toString(), borrowedAmount1.mul(multiplierA).toString()).toString();
    const price1 = BigNumber.from(exchRate1).div(multiplierB);
    await priceFeed.setAnswer(price1);

    depositAmountAFromB = await primexPricingLibrary.getOracleAmountsOut(
      testTokenB.address,
      testTokenA.address,
      depositAmountB,
      priceOracle.address,
    );
    const leverage1 = BigNumber.from(WAD).add(wadDiv(borrowedAmount1.toString(), depositAmountAFromB.toString()).toString());
    const positionSize1 = wadMul(depositAmountAFromB.add(borrowedAmount1).toString(), leverage1.toString()).toString();

    const feeAmountCalculateWithETHRateB = wadMul(
      BigNumber.from(positionSize1).mul(multiplierA).toString(),
      protocolRate.toString(),
    ).toString();
    const feeAmountInEthB = wadMul(feeAmountCalculateWithETHRateB.toString(), PriceInETH.toString()).toString();

    // open second position
    await testTokenB.connect(trader).approve(traderBalanceVault.address, depositAmountB);
    await traderBalanceVault.connect(trader).deposit(testTokenB.address, depositAmountB);
    await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEthB });

    await positionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount1,
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
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[1], positionsStopLoss[1])),
      ],
    });
    timestamps.push((await provider.getBlock("latest")).timestamp);

    /// ////////////// POSITION 3 ////////////////
    const amountBOut2 = await getAmountsOut(dex, borrowedAmount2, [testTokenA.address, testTokenB.address]);
    const amountBinWAD2 = amountBOut2.mul(multiplierB);
    const exchRate2 = wadDiv(amountBinWAD2.toString(), borrowedAmount2.mul(multiplierA).toString()).toString();
    const price2 = BigNumber.from(exchRate2).div(multiplierB);
    await priceFeed.setAnswer(price2);

    const depositAmountAXFromDex = await getAmountsOut(dex, depositAmountX, [testTokenX.address, testTokenA.address]);
    const amountAFromX = depositAmountAXFromDex.mul(multiplierA);
    const amountX = depositAmountX.mul(multiplierX);
    const exchangeXArate = wadDiv(amountX.toString(), amountAFromX.toString()).toString();
    const priceXA = BigNumber.from(exchangeXArate).div(multiplierA);
    await priceFeedTTXTTA.setAnswer(priceXA);
    await priceFeedTTXTTA.setDecimals(decimalsA);

    depositAmountAFromX = await primexPricingLibrary.getOracleAmountsOut(
      testTokenX.address,
      testTokenA.address,
      depositAmountX,
      priceOracle.address,
    );
    const leverage2 = BigNumber.from(WAD).add(wadDiv(borrowedAmount2.toString(), depositAmountAFromX.toString()).toString());
    const positionSize2 = wadMul(depositAmountX.toString(), leverage2.toString()).toString();

    const feeAmountCalculateWithETHRateX = wadMul(
      BigNumber.from(positionSize2).mul(multiplierX).toString(),
      protocolRate.toString(),
    ).toString();
    const feeAmountInEthX = wadMul(feeAmountCalculateWithETHRateX.toString(), PriceInETH.toString()).toString();

    // open third position
    await testTokenX.connect(trader).approve(traderBalanceVault.address, depositAmountX);
    await traderBalanceVault.connect(trader).deposit(testTokenX.address, depositAmountX);
    await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEthX });

    await positionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount2,
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
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[2], positionsStopLoss[2])),
      ],
    });
    timestamps.push((await provider.getBlock("latest")).timestamp);

    const { positionsData } = await PrimexLens.getArrayOpenPositionDataByTrader(positionManager.address, trader.address, 0, 10);
    positionAmount0 = positionsData[0].positionSize;
    positionAmount1 = positionsData[1].positionSize;
    positionAmount2 = positionsData[2].positionSize;

    const amount0Out2 = await getAmountsOut(dex, positionAmount2, [testTokenB.address, testTokenA.address]);
    const amountA = amount0Out2.mul(multiplierA);

    const amountB = positionAmount2.mul(multiplierB);

    dexExchangeRateTtaTtb = wadDiv(amountB.toString(), amountA.toString()).toString();
    const priceTtaTtb = BigNumber.from(dexExchangeRateTtaTtb).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
    await priceFeed.setAnswer(priceTtaTtb);

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

    bestShares2 = (await BestDexLens.callStatic.getBestDexByPosition(positionManager.address, 2, 1, dexesWithAncillaryData)).routes;

    positionDebt0 = await positionManager.getPositionDebt(0);
    positionDebt1 = await positionManager.getPositionDebt(1);
    positionDebt2 = await positionManager.getPositionDebt(2);
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
    let snapshotId, lensFactory;
    before(async function () {
      const primexPricingLibrary = await getContract("PrimexPricingLibrary");
      lensFactory = await getContractFactory("PrimexLens", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
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

    it("Should deploy", async function () {
      const takeProfitStopLossCondition = await getContract("TakeProfitStopLossCCM");
      expect(await lensFactory.deploy(takeProfitStopLossCondition.address));
    });

    it("Should revert deploy when takeProfitStopLossCCM address not supported", async function () {
      await expect(lensFactory.deploy(traderBalanceVault.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("getPositionStatus", function () {
    it("Should return correctly position status", async function () {
      const { liquidationThreshold, takeProfitReached, stopLossReached } = await PrimexLens.callStatic.getPositionStatus(
        positionManager.address,
        2,
        bestShares2,
      );
      expect(liquidationThreshold).to.be.equal(false);
      expect(takeProfitReached).to.be.equal(true);
      expect(stopLossReached).to.be.equal(false);
    });
  });

  describe("getArrayOpenPositionDataByTrader", function () {
    let cursor, count;
    let expectedValues;

    before(async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();

      expectedValues = [
        [
          {
            id: 0,
            bucket: await getBucketMetaData(bucket.address, trader),
            pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
            positionSize: positionAmount0,
            liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 0),
            stopLossPrice: positionsStopLoss[0],
            takeProfitPrice: positionsTakeProfit[0],
            debt: positionDebt0,
            depositAmount: depositAmountA,
            createdAt: timestamps[0],
          },
          {
            id: 1,
            bucket: await getBucketMetaData(bucket.address, trader),
            pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
            positionSize: positionAmount1,
            liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 1),
            stopLossPrice: positionsStopLoss[1],
            takeProfitPrice: positionsTakeProfit[1],
            debt: positionDebt1,
            depositAmount: depositAmountAFromB,
            createdAt: timestamps[1],
          },
          {
            id: 2,
            bucket: await getBucketMetaData(bucket.address, trader),
            pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
            positionSize: positionAmount2,
            liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 2),
            stopLossPrice: positionsStopLoss[2],
            takeProfitPrice: positionsTakeProfit[2],
            debt: positionDebt2,
            depositAmount: depositAmountAFromX,
            createdAt: timestamps[2],
          },
        ],
        0,
      ];
    });

    it("should return empty data if position by trader does not exist, cursor greater or equal position length", async function () {
      cursor = 3;
      count = 10;
      parseArguments(
        [[], 0],
        await PrimexLens.callStatic.getArrayOpenPositionDataByTrader(positionManager.address, trader.address, cursor, count),
      );
    });
    it("should return all positions data by trader, cursor plus count greater than positions length", async function () {
      cursor = 0;
      count = 10;
      parseArguments(
        expectedValues,
        await PrimexLens.callStatic.getArrayOpenPositionDataByTrader(positionManager.address, trader.address, cursor, count),
      );
    });
    it("should return correct positions data by trader and new cursor when cursor plus count less than positions length ", async function () {
      cursor = 1;
      count = 1;
      const expectedNewCursor = cursor + count;
      expectedValues[1] = expectedNewCursor;
      expectedValues[0].splice(2, 1);
      expectedValues[0].splice(0, 1);
      const result = await PrimexLens.callStatic.getArrayOpenPositionDataByTrader(positionManager.address, trader.address, cursor, count);
      const newCursor = result[1].toNumber();
      expect(newCursor).to.equal(expectedNewCursor);

      parseArguments(
        expectedValues,
        await PrimexLens.callStatic.getArrayOpenPositionDataByTrader(positionManager.address, trader.address, cursor, count),
      );
    });
    it("should revert if positionManager address is not correct", async function () {
      cursor = 0;
      count = 2;
      const DexAdapter = await getContract("DexAdapter");
      await expect(
        PrimexLens.callStatic.getArrayOpenPositionDataByTrader(DexAdapter.address, trader.address, cursor, count),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("getArrayOpenPositionDataByBucket", function () {
    let cursor, count;
    let expectedValues;

    before(async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();

      expectedValues = [
        [
          {
            id: 0,
            bucket: await getBucketMetaData(bucket.address, trader),
            pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
            positionSize: positionAmount0,
            liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 0),
            stopLossPrice: positionsStopLoss[0],
            takeProfitPrice: positionsTakeProfit[0],
            debt: positionDebt0,
            depositAmount: depositAmountA,
            createdAt: timestamps[0],
          },
          {
            id: 1,
            bucket: await getBucketMetaData(bucket.address, trader),
            pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
            positionSize: positionAmount1,
            liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 1),
            stopLossPrice: positionsStopLoss[1],
            takeProfitPrice: positionsTakeProfit[1],
            debt: positionDebt1,
            depositAmount: depositAmountAFromB,
            createdAt: timestamps[1],
          },
          {
            id: 2,
            bucket: await getBucketMetaData(bucket.address, trader),
            pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
            positionSize: positionAmount2,
            liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 2),
            stopLossPrice: positionsStopLoss[2],
            takeProfitPrice: positionsTakeProfit[2],
            debt: positionDebt2,
            depositAmount: depositAmountAFromX,
            createdAt: timestamps[2],
          },
        ],
        0,
      ];
    });

    it("should return empty data if position by bucket does not exist, cursor greater or equal position length", async function () {
      cursor = 3;
      count = 10;
      parseArguments(
        [[], 0],
        await PrimexLens.callStatic.getArrayOpenPositionDataByBucket(positionManager.address, bucket.address, cursor, count),
      );
    });
    it("should return all positions data by bucket, cursor plus count greater than positions length", async function () {
      cursor = 0;
      count = 10;
      parseArguments(
        expectedValues,
        await PrimexLens.callStatic.getArrayOpenPositionDataByBucket(positionManager.address, bucket.address, cursor, count),
      );
    });
    it("should return correct positions data by bucket and new cursor when cursor plus count less than positions length ", async function () {
      cursor = 1;
      count = 1;
      const expectedNewCursor = cursor + count;
      expectedValues[1] = expectedNewCursor;
      expectedValues[0].splice(2, 1);
      expectedValues[0].splice(0, 1);
      const result = await PrimexLens.callStatic.getArrayOpenPositionDataByBucket(positionManager.address, bucket.address, cursor, count);
      const newCursor = result[1].toNumber();
      expect(newCursor).to.equal(expectedNewCursor);
      parseArguments(
        expectedValues,
        await PrimexLens.callStatic.getArrayOpenPositionDataByBucket(positionManager.address, bucket.address, cursor, count),
      );
    });
    it("should revert if positionManager address is not correct", async function () {
      cursor = 0;
      count = 2;
      const DexAdapter = await getContract("DexAdapter");
      await expect(
        PrimexLens.callStatic.getArrayOpenPositionDataByBucket(DexAdapter.address, bucket.address, cursor, count),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("getOpenPositionsWithConditions", function () {
    let positionIds, cursor, count;
    let position0, position1, position2;
    before(async function () {
      const openBorrowIndex = (await positionManager.getPosition(0)).openBorrowIndex;
      const openBorrowIndex1 = (await positionManager.getPosition(1)).openBorrowIndex;
      const openBorrowIndex2 = (await positionManager.getPosition(2)).openBorrowIndex;

      const scaledDebtAmount0 = rayDiv(borrowedAmount0.toString(), openBorrowIndex.toString()).toString();
      const scaledDebtAmount1 = rayDiv(borrowedAmount1.toString(), openBorrowIndex1.toString()).toString();
      const scaledDebtAmount2 = rayDiv(borrowedAmount2.toString(), openBorrowIndex2.toString()).toString();

      position0 = [
        BigNumber.from("0"),
        scaledDebtAmount0,
        bucket.address,
        testTokenA.address,
        depositAmountA,
        testTokenB.address,
        positionAmount0,
        trader.address,
        openBorrowIndex,
        timestamps[0],
        timestamps[0],
        "0x",
      ];

      position1 = [
        BigNumber.from("1"),
        scaledDebtAmount1,
        bucket.address,
        testTokenA.address,
        depositAmountAFromB,
        testTokenB.address,
        positionAmount1,
        trader.address,
        openBorrowIndex1,
        timestamps[1],
        timestamps[1],
        "0x",
      ];

      position2 = [
        BigNumber.from("2"),
        scaledDebtAmount2,
        bucket.address,
        testTokenA.address,
        depositAmountAFromX,
        testTokenB.address,
        positionAmount2,
        trader.address,
        openBorrowIndex2,
        timestamps[2],
        timestamps[2],
        "0x",
      ];
    });

    it("should return empty data if position does not exist, cursor greater or equal position length", async function () {
      cursor = 3;
      count = 10;
      const expectedValues = [[], 0];
      parseArguments(expectedValues, await PrimexLens.getOpenPositionsWithConditions(positionManager.address, cursor, count));
    });
    it("should return all positions data, cursor plus count greater than position length", async function () {
      cursor = 0;
      count = 10;
      const expectedValues = [
        [
          [
            position0,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[0], positionsStopLoss[0]))],
          ],
          [
            position1,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[1], positionsStopLoss[1]))],
          ],
          [
            position2,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[2], positionsStopLoss[2]))],
          ],
        ],
        0,
      ];
      parseArguments(expectedValues, await PrimexLens.callStatic.getOpenPositionsWithConditions(positionManager.address, cursor, count));
    });
    it("should return correct conditions data if a position is closed", async function () {
      positionIds = [0, 1];
      cursor = 0;
      count = 2;

      const expectedValues = [
        [
          [
            position0,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[0], positionsStopLoss[0]))],
          ],
          [
            position1,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[1], positionsStopLoss[1]))],
          ],
        ],
        2,
      ];
      parseArguments(expectedValues, await PrimexLens.callStatic.getOpenPositionsWithConditions(positionManager.address, cursor, count));
      const assetRoutes = await getSingleRoute([testTokenB.address, testTokenA.address], dex);

      await positionManager.connect(trader).closePosition(positionIds[0], trader.address, assetRoutes, 0);

      const expectedValues1 = [
        [
          [
            position2,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[2], positionsStopLoss[2]))],
          ],
          [
            position1,
            [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(positionsTakeProfit[1], positionsStopLoss[1]))],
          ],
        ],
        0,
      ];
      parseArguments(expectedValues1, await PrimexLens.callStatic.getOpenPositionsWithConditions(positionManager.address, cursor, count));
    });
    it("should revert if positionManager address is not correct", async function () {
      cursor = 0;
      count = 2;
      const DexAdapter = await getContract("DexAdapter");
      await expect(PrimexLens.getOpenPositionsWithConditions(DexAdapter.address, cursor, count)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("getLimitOrdersWithConditions", function () {
    let cursor, count;
    let order0, order1;
    let conditionsOrder0, conditionsOrder1;

    before(async function () {
      // create first order
      const depositAmount = parseUnits("15", decimalsA);
      const deadline = new Date().getTime() + 600;
      const takeDepositFromWallet = true;
      const payFeeFromWallet = true;
      const leverage = parseEther("5");
      multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));

      const swapSize = wadMul(depositAmount.toString(), leverage.toString()).toString();
      const feeAmountCalculateWithPMXRate = wadMul(
        BigNumber.from(swapSize).mul(multiplierA).toString(),
        limitOrderProtocolRateInPmx.toString(),
      ).toString();
      const feeAmountInPmx = wadMul(feeAmountCalculateWithPMXRate.toString(), ttaPriceInPMX.toString()).toString();

      await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);

      conditionsOrder0 = [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(leverage.div(multiplierA)))];
      await PMXToken.transfer(trader.address, BigNumber.from(feeAmountInPmx).mul(2));
      await PMXToken.connect(trader).approve(limitOrderManager.address, BigNumber.from(feeAmountInPmx).mul(2));

      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        payFeeFromWallet: payFeeFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: conditionsOrder0,
        closeConditions: [],
        isProtocolFeeInPmx: true,
      });
      const createdAt0 = (await provider.getBlock("latest")).timestamp;

      // create second order
      const exchangeRate = parseUnits("1", decimalsA);
      conditionsOrder1 = [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(exchangeRate))];
      await testTokenA.connect(trader).approve(limitOrderManager.address, depositAmount);
      await limitOrderManager.connect(trader).createLimitOrder({
        bucket: "bucket1",
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        deadline: deadline,
        takeDepositFromWallet: takeDepositFromWallet,
        payFeeFromWallet: payFeeFromWallet,
        leverage: leverage,
        shouldOpenPosition: true,
        openConditions: conditionsOrder1,
        closeConditions: [],
        isProtocolFeeInPmx: true,
      });
      const createdAt1 = (await provider.getBlock("latest")).timestamp;

      order0 = [
        bucket.address,
        testTokenB.address,
        testTokenA.address,
        depositAmount,
        PMXToken.address,
        feeAmountInPmx,
        trader.address,
        deadline,
        1,
        leverage,
        true,
        createdAt0,
        createdAt0,
        "0x",
      ];

      order1 = [
        bucket.address,
        testTokenB.address,
        testTokenA.address,
        depositAmount,
        PMXToken.address,
        feeAmountInPmx,
        trader.address,
        deadline,
        2,
        leverage,
        true,
        createdAt1,
        createdAt1,
        "0x",
      ];
    });

    it("should return empty data if order does not exist, cursor greater or equal orders length", async function () {
      cursor = 3;
      count = 10;
      parseArguments([[], 0], await PrimexLens.callStatic.getLimitOrdersWithConditions(limitOrderManager.address, cursor, count));
    });
    it("should return all orders data, cursor plus count greater or equal orders length", async function () {
      cursor = 0;
      count = 2;
      const expectedValues = [
        [
          [order0, conditionsOrder0],
          [order1, conditionsOrder1],
        ],
        0,
      ];

      parseArguments(expectedValues, await PrimexLens.callStatic.getLimitOrdersWithConditions(limitOrderManager.address, cursor, count));
    });
    it("should return correct conditions data if a order is closed", async function () {
      cursor = 0;
      count = 2;
      const expectedValues = [
        [
          [order0, conditionsOrder0],
          [order1, conditionsOrder1],
        ],
        0,
      ];
      parseArguments(expectedValues, await PrimexLens.callStatic.getLimitOrdersWithConditions(limitOrderManager.address, cursor, count));

      const orderId = 1;
      await limitOrderManager.connect(trader).cancelLimitOrder(orderId);
      const expectedValues1 = [[[order1, conditionsOrder1]], 0];
      parseArguments(expectedValues1, await PrimexLens.callStatic.getLimitOrdersWithConditions(limitOrderManager.address, cursor, count));
    });
    it("should revert if Limit order Manager address is not correct", async function () {
      cursor = 0;
      count = 2;
      const DexAdapter = await getContract("DexAdapter");
      await expect(
        PrimexLens["getLimitOrdersWithConditions(address,uint256,uint256)"](DexAdapter.address, cursor, count),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("getLiquidationPrice for openable positions", function () {
    it("should return correct values", async function () {
      const borrowedAmount4 = borrowedAmount2;
      const positionAmount4 = await getAmountsOut(dex, depositAmountA.add(borrowedAmount4), [testTokenA.address, testTokenB.address]);

      const feeAmountCalculateWithETHRate = wadMul(
        depositAmountA.add(borrowedAmount4).mul(multiplierA).toString(),
        protocolRate.toString(),
      ).toString();
      const feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

      const liquidationPricePreliminary = await PrimexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
        positionManager.address,
        "bucket1",
        borrowedAmount4,
        testTokenB.address,
        positionAmount4,
      );

      const deadline = new Date().getTime() + 600;
      const feeAmountA = wadMul(depositAmountA.add(borrowedAmount4).toString(), protocolRate.toString()).toString();
      const depositAndFeeA = depositAmountA.add(feeAmountA);
      await testTokenA.mint(trader.address, depositAmountA);
      await testTokenA.connect(trader).approve(positionManager.address, depositAndFeeA);
      await priceFeed.setAnswer(1);

      const multiplier1 = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const multiplier2 = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

      await positionManager.connect(trader).openPosition(
        {
          marginParams: {
            bucket: "bucket1",
            borrowedAmount: borrowedAmount4,
            depositInThirdAssetRoutes: [],
          },
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenA.address,
          depositAmount: depositAmountA,
          positionAsset: testTokenB.address,
          amountOutMin: 0,
          deadline: deadline,
          takeDepositFromWallet: true,
          payFeeFromWallet: true,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

      // position 4
      const denominator = wadMul(
        wadMul(
          wadMul(BigNumber.from(WAD).sub(securityBuffer).toString(), BigNumber.from(WAD).sub(oracleTolerableLimit).toString()),
          BigNumber.from(WAD).sub(pairPriceDrop).toString(),
        ),
        positionAmount4.toString(),
      ).toString();
      const denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplier2);
      const numerator = wadMul(feeBuffer.toString(), borrowedAmount4.toString()).toString();
      const numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplier1);

      const liquidationPrice4 = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();
      const liquidationPriceInBorroweAssetDecimals = BigNumber.from(liquidationPrice4).div(multiplier1);

      const count = await positionManager.getTraderPositionsLength(trader.address);
      const liquidationPriceFinal = await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, count - 1);
      expect(liquidationPriceInBorroweAssetDecimals).to.equal(liquidationPriceFinal);
      expect(liquidationPriceInBorroweAssetDecimals).to.equal(liquidationPricePreliminary);
      await priceFeed.setAnswer(dexExchangeRateTtaTtb);
    });
    it("should revert if first argument isn't positionManager", async function () {
      const DexAdapter = await getContract("DexAdapter");
      await expect(PrimexLens["getLiquidationPrice(address,uint256)"](DexAdapter.address, 0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("should revert if positionAsset isn't allowed in bucket", async function () {
      const borrowedAmount4 = borrowedAmount2;
      const positionAmount4 = await getAmountsOut(dex, depositAmountA.add(borrowedAmount4), [testTokenA.address, testTokenB.address]);

      await expect(
        PrimexLens["getLiquidationPrice(address,string,uint256,address,uint256)"](
          positionManager.address,
          "bucket1",
          borrowedAmount4,
          trader.address,
          positionAmount4,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
    });
  });

  describe("getPositionMaxDecrease", function () {
    // maxDecrease = (1 - priceDrop) * borrowedAssetAmountOut / feeBuffer - position.bucket.getNormalizedVariableDebt() * position.scaledDebtAmount

    it("should return depositAmount if max decrease > depositAmount", async function () {
      const positionId = 0;
      const position = await positionManager.getPosition(positionId);
      const maxDecrease = await PrimexLens.getPositionMaxDecrease(positionManager.address, positionId);
      expect(maxDecrease).to.equal(position.depositAmountInSoldAsset);

      await positionManager.connect(trader).decreaseDeposit(positionId, maxDecrease);
      const positionAfter = await positionManager.getPosition(positionId);
      expect(positionAfter.depositAmountInSoldAsset).to.equal(0);
    });

    it("should get position max decrease", async function () {
      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmountA);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmountA);
      const swapSize = depositAmountA.add(borrowedAmount0);
      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const swap = swapSize.mul(multiplierA);

      const feeAmountCalculateWithETHRate = wadMul(swapSize.toString(), protocolRate.toString()).toString();
      const feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

      const amountBOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
      const amountB = amountBOut.mul(multiplierB);

      dexExchangeRateTtaTtb = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(dexExchangeRateTtaTtb).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB)));
      await priceFeed.setAnswer(price);
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: feeAmountInEth });

      const positionId = await positionManager.positionsId();
      await positionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount0,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: firstAssetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmountA,
        positionAsset: testTokenB.address,
        amountOutMin: 0,
        deadline: new Date().getTime() + 600,
        takeDepositFromWallet: false,
        payFeeFromWallet: false,
        closeConditions: [],
      });
      const position = await positionManager.getPosition(positionId);
      const pairPriceDrop = await priceOracle.pairPriceDrops(position.positionAsset, await bucket.borrowedAsset());
      const feeBuffer = await bucket.feeBuffer();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
      const maintenanceBuffer = await positionManager.maintenanceBuffer();
      const amount0OutOracle = wadDiv(position.positionAmount.toString(), price.toString()).toString();
      const multiplier = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const amount0OutOracleInBorrowedDecimals = BigNumber.from(amount0OutOracle).div(multiplier);

      const bnWAD = BigNumber.from(WAD.toString());
      const normalizedVariableDebt = await bucket.getNormalizedVariableDebt();

      let maxDebt = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracleInBorrowedDecimals.toString(),
      ).toString();

      maxDebt = wadDiv(maxDebt, wadMul(feeBuffer.toString(), bnWAD.add(maintenanceBuffer).toString()).toString()).toString();

      const currentDebt = rayMul(position.scaledDebtAmount.toString(), normalizedVariableDebt.toString()).toString();
      const depositDecrease = BigNumber.from(maxDebt).sub(BigNumber.from(currentDebt));

      const maxDecrease = await PrimexLens.getPositionMaxDecrease(positionManager.address, positionId);
      expect(maxDecrease).to.equal(BigNumber.from(depositDecrease));
      // add 10% to the maxDecrease
      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(positionId, wadMul(maxDecrease.toString(), bnWAD.add(bnWAD.div("10")).toString()).toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_DEPOSIT_SIZE");
      const safeDecrease = wadMul(maxDecrease.toString(), bnWAD.sub(bnWAD.div("10")).toString()).toString(); // 90%
      await positionManager.connect(trader).decreaseDeposit(positionId, safeDecrease);
      const positionAfter = await positionManager.getPosition(positionId);
      expect(positionAfter.depositAmountInSoldAsset).to.equal(depositAmountA.sub(BigNumber.from(safeDecrease)));
    });
  });

  it("getBucket return correct values", async function () {
    parseArguments(await PrimexLens.getBucket(bucket.address, trader.address), await getBucketMetaData(bucket.address, trader));
  });

  it("getBucketsArray does not return a bucket if it is deprecated and 'showDeprecated' param is false and there is no user's deposit in a bucket", async function () {
    const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
      nameBucket: "bucketWithNoDeposit",
      assets: `["${testTokenB.address}"]`,
      pairPriceDrops: "[\"100000000000000000\"]",
      feeBuffer: "1000100000000000000", // 1.0001
      withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
      reserveRate: "100000000000000000", // 0.1 - 10%,
      underlyingAsset: testTokenA.address,
      liquidityMiningRewardDistributor: "0",
      liquidityMiningAmount: "0",
      liquidityMiningDeadline: "0",
      stabilizationDuration: "0",
      pmxRewardAmount: "0",
      estimatedBar: "100000000000000000000000000", // 0.1 in ray
      estimatedLar: "70000000000000000000000000", // 0.07 in ray
      maxAmountPerUser: MaxUint256.toString(),
      barCalcParams: JSON.stringify(barCalcParams),
      maxTotalDeposit: MaxUint256.toString(),
    });
    const newBucket = await getContractAt("Bucket", newBucketAddress);

    await PrimexDNS.deprecateBucket(await newBucket.name());
    expect(await newBucket.isDeprecated()).to.be.equal(true);

    const bucketsFromLens = await PrimexLens.getBucketsArray([newBucketAddress], lender.address, positionManager.address, false);
    expect(bucketsFromLens.length).to.be.equal(0);
  });

  it("getBucketsArray returns correct values if the bucket is deprecated and 'showDeprecated' param is false but there is user's deposit in a bucket", async function () {
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("100", decimalsA), true);

    await PrimexDNS.deprecateBucket(await bucket.name());
    expect(await bucket.isDeprecated()).to.be.equal(true);

    const bucketsFromLens = await PrimexLens.getBucketsArray([bucket.address], lender.address, positionManager.address, false);
    const expectedBucket = await getBucketMetaData(bucket.address, lender);
    expect(bucketsFromLens.length).to.be.equal(1);
    expect(bucketsFromLens[0].name).to.be.equal(expectedBucket.name);
    expect(bucketsFromLens[0].bucketAddress).to.be.equal(expectedBucket.bucketAddress);
    expect(bucketsFromLens[0].isDeprecated).to.be.equal(expectedBucket.isDeprecated);
    expect(bucketsFromLens[0].isDeprecated).to.be.equal(true);
  });

  it("getBucketsArray returns correct values if the bucket is deprecated and 'showDeprecated' param is true", async function () {
    await PrimexDNS.deprecateBucket(await bucket.name());
    expect(await bucket.isDeprecated()).to.be.equal(true);
    const bucketsFromLens = await PrimexLens.getBucketsArray([bucket.address], trader.address, positionManager.address, true);
    const expectedBucket = await getBucketMetaData(bucket.address, trader);
    expect(bucketsFromLens.length).to.be.equal(1);
    expect(bucketsFromLens[0].name).to.be.equal(expectedBucket.name);
    expect(bucketsFromLens[0].bucketAddress).to.be.equal(expectedBucket.bucketAddress);
    expect(bucketsFromLens[0].isDeprecated).to.be.equal(true);
  });

  it("getBucketsArray does not return empty buckets", async function () {
    // bucket 1 - deprecated, with deposit
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("100", decimalsA), true);
    await PrimexDNS.deprecateBucket(await bucket.name());
    expect(await bucket.isDeprecated()).to.be.equal(true);

    // bucket 2 - deprecated, without deposit
    const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
      nameBucket: "bucketWithNoDeposit",
      assets: `["${testTokenB.address}"]`,
      pairPriceDrops: "[\"100000000000000000\"]",
      feeBuffer: "1000100000000000000", // 1.0001
      withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
      reserveRate: "100000000000000000", // 0.1 - 10%,
      underlyingAsset: testTokenA.address,
      liquidityMiningRewardDistributor: "0",
      liquidityMiningAmount: "0",
      liquidityMiningDeadline: "0",
      stabilizationDuration: "0",
      pmxRewardAmount: "0",
      estimatedBar: "100000000000000000000000000", // 0.1 in ray
      estimatedLar: "70000000000000000000000000", // 0.07 in ray
      maxAmountPerUser: MaxUint256.toString(),
      barCalcParams: JSON.stringify(barCalcParams),
      maxTotalDeposit: MaxUint256.toString(),
    });
    const newBucket = await getContractAt("Bucket", newBucketAddress);

    await PrimexDNS.deprecateBucket(await newBucket.name());
    expect(await newBucket.isDeprecated()).to.be.equal(true);

    const bucketsFromLens = await PrimexLens.getBucketsArray(
      [bucket.address, newBucketAddress],
      lender.address,
      positionManager.address,
      false,
    );
    const expectedBucket = await getBucketMetaData(bucket.address, lender);

    expect(bucketsFromLens.length).to.equal(1);
    expect(bucketsFromLens[0].name).to.be.equal(expectedBucket.name);
    expect(bucketsFromLens[0].bucketAddress).to.be.equal(expectedBucket.bucketAddress);
    expect(bucketsFromLens[0].isDeprecated).to.be.equal(true);
  });

  it("getBucketsArray does not return a bucket if it is not added to PrimexDNS", async function () {
    const BucketsFactory = await getContract("BucketsFactory");

    const nameBucket = "bucket2";
    const assets = [];
    const pairPriceDrops = [];
    const reserveAddress = await bucket.reserve();
    const reserve = await getContractAt("Reserve", reserveAddress);
    const mockInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
    const mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    const BAR_CALC_PARAMS_DECODE = ["(uint256,uint256,uint256,uint256,int256)"];
    const barCalcParams2 = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]);
    await BucketsFactory.createBucket({
      nameBucket: nameBucket,
      positionManager: positionManager.address,
      priceOracle: priceOracle.address,
      dns: PrimexDNS.address,
      reserve: reserve.address,
      assets: assets,
      whiteBlackList: mockWhiteBlackList.address,
      pairPriceDrops: pairPriceDrops,
      underlyingAsset: testTokenA.address,
      feeBuffer: parseEther("1.0002").toString(),
      withdrawalFeeRate: parseEther("0.005").toString(),
      reserveRate: parseEther("0.1").toString(),
      liquidityMiningRewardDistributor: AddressZero,
      liquidityMiningAmount: 0,
      liquidityMiningDeadline: 0,
      stabilizationDuration: 0,
      interestRateStrategy: mockInterestRateStrategy.address,
      maxAmountPerUser: 0,
      isReinvestToAaveEnabled: false,
      estimatedBar: parseUnits("0.1", 27), // 0.1 in ray
      estimatedLar: parseUnits("0.07", 27), // 0.07 in ray
      barCalcParams: barCalcParams2,
      maxTotalDeposit: MaxUint256.toString(),
    });

    const bucket2 = await getContractAt("Bucket", await BucketsFactory.buckets(1));

    const bucketsFromLens = await PrimexLens.getBucketsArray(
      [bucket.address, bucket2.address],
      lender.address,
      positionManager.address,
      false,
    );
    const expectedBucket = await getBucketMetaData(bucket.address, lender);

    expect(bucketsFromLens.length).to.equal(1);
    expect(bucketsFromLens[0].name).to.be.equal(expectedBucket.name);
    expect(bucketsFromLens[0].bucketAddress).to.be.equal(expectedBucket.bucketAddress);
    expect(bucketsFromLens[0].isDeprecated).to.be.equal(false);
  });

  it("getOpenPositionData return correct values", async function () {
    const expectedValues = {
      id: 0,
      bucket: await getBucketMetaData(bucket.address, trader),
      pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
      positionSize: positionAmount0,
      liquidationPrice: await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 0),
      stopLossPrice: positionsStopLoss[0],
      takeProfitPrice: positionsTakeProfit[0],
      debt: positionDebt0,
      depositAmount: depositAmountA,
      createdAt: timestamps[0],
    };

    parseArguments(expectedValues, await PrimexLens.callStatic.getOpenPositionData(positionManager.address, 0));
  });

  it("getOpenPositionData return correct values for spot position", async function () {
    const deadline = new Date().getTime() + 600;
    const TTBUSD = parseUnits("10000", decimalsUSD);
    await priceFeedTTBUSD.setAnswer(TTBUSD);
    // await priceFeed.setAnswer("1");
    await testTokenA.connect(trader).approve(positionManager.address, depositAmountA);

    const feeAmountCalculateWithETHRate = wadMul(
      depositAmountA.add(borrowedAmount0).mul(multiplierA).toString(),
      protocolRate.toString(),
    ).toString();
    const feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), PriceInETH.toString()).toString();

    await positionManager.connect(trader).openPosition(
      {
        marginParams: {
          bucket: "",
          borrowedAmount: 0,
          depositInThirdAssetRoutes: [],
        },
        firstAssetRoutes: firstAssetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmountA,
        positionAsset: testTokenB.address,
        amountOutMin: 0,
        deadline: deadline,
        takeDepositFromWallet: true,
        payFeeFromWallet: true,
        closeConditions: [],
      },
      { value: feeAmountInEth },
    );
    const timestamp = (await provider.getBlock("latest")).timestamp;

    const position4 = await positionManager.getPosition(3);

    const expectedValues = {
      id: 3,
      bucket: emptyBucketMetaData,
      pair: [await getTokenMetadata(testTokenA.address, trader), await getTokenMetadata(testTokenB.address, trader)],
      positionSize: position4.positionAmount,
      liquidationPrice: 0,
      stopLossPrice: 0,
      takeProfitPrice: 0,
      debt: 0,
      depositAmount: depositAmountA,
      createdAt: timestamp,
    };

    parseArguments(expectedValues, await PrimexLens.callStatic.getOpenPositionData(positionManager.address, 3));
  });

  it("getLiquidationPrice return correct values", async function () {
    const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
    const feeBuffer = await bucket.feeBuffer();
    const securityBuffer = await positionManager.securityBuffer();
    const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

    const multiplier1 = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    const multiplier2 = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    // position 0
    let denominator = wadMul(
      wadMul(
        wadMul(BigNumber.from(WAD).sub(securityBuffer).toString(), BigNumber.from(WAD).sub(oracleTolerableLimit).toString()),
        BigNumber.from(WAD).sub(pairPriceDrop).toString(),
      ),
      positionAmount0.toString(),
    ).toString();

    let denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplier2);
    let numerator = wadMul(feeBuffer.toString(), positionDebt0.toString()).toString();
    let numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplier1);

    const liquidationPrice0 = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();
    let liquidationPriceInBorroweAssetDecimals = BigNumber.from(liquidationPrice0).div(multiplier1);

    expect(await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 0)).to.equal(
      liquidationPriceInBorroweAssetDecimals,
    );

    // position 1
    denominator = wadMul(
      wadMul(
        wadMul(BigNumber.from(WAD).sub(securityBuffer).toString(), BigNumber.from(WAD).sub(oracleTolerableLimit).toString()),
        BigNumber.from(WAD).sub(pairPriceDrop).toString(),
      ),
      positionAmount1.toString(),
    ).toString();
    denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplier2);
    numerator = wadMul(feeBuffer.toString(), positionDebt1.toString()).toString();
    numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplier1);

    const liquidationPrice1 = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();
    liquidationPriceInBorroweAssetDecimals = BigNumber.from(liquidationPrice1).div(multiplier1);

    expect(await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 1)).to.equal(
      liquidationPriceInBorroweAssetDecimals,
    );

    // position 2
    denominator = wadMul(
      wadMul(
        wadMul(BigNumber.from(WAD).sub(securityBuffer).toString(), BigNumber.from(WAD).sub(oracleTolerableLimit).toString()),
        BigNumber.from(WAD).sub(pairPriceDrop).toString(),
      ),
      positionAmount2.toString(),
    ).toString();
    denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplier2);
    numerator = wadMul(feeBuffer.toString(), positionDebt2.toString()).toString();
    numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplier1);

    const liquidationPrice2 = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();
    liquidationPriceInBorroweAssetDecimals = BigNumber.from(liquidationPrice2).div(multiplier1);

    expect(await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, 2)).to.equal(
      liquidationPriceInBorroweAssetDecimals,
    );
  });
});
