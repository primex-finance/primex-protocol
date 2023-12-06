const {
  network,
  ethers: {
    getNamedSigners,
    getContract,
    getContractAt,
    utils: { parseUnits, hexZeroPad },
    constants: { HashZero, Zero },
    BigNumber,
  },
} = require("hardhat");
const { getAmountsOut } = require("../../test/utils/dexOperations");
const { MAX_TOKEN_DECIMALITY, NATIVE_CURRENCY } = require("../../test/utils/constants");
const { wadDiv, wadMul } = require("../../test/utils/math");
const { getConfig } = require("../../config/configUtils");
const { assets } = getConfig();

async function setCorrectOraclePrice({ swapSize, dex, tokenA, tokenB, aTokenDecimals, bTokenDecimals }) {
  if (!swapSize || swapSize.eq(Zero)) return Zero;
  const priceFeedUpdaterTestService = await getContract("PriceFeedUpdaterTestService");
  let amountOutB = await getAmountsOut(dex, swapSize, [tokenA, tokenB]);
  amountOutB = amountOutB.mul(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(bTokenDecimals)));
  const priceOracle = await getContract("PriceOracle");
  const { basePriceFeed, quotePriceFeed } = await priceOracle.getPriceFeedsPair(tokenA, tokenB);
  const quotePriceFeedContract = await getContractAt("PrimexAggregatorV3TestService", quotePriceFeed);
  let quotePrice = (await quotePriceFeedContract.latestRoundData())[1];

  const isForward = (await priceOracle.getExchangeRate(tokenA, tokenB))[1];
  let basePrice;
  quotePrice = quotePrice.mul(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub("8")));
  if (isForward) {
    // (amountB * mulB) / (amountA * mulA) * quotePrice
    const targetPrice = wadDiv(
      amountOutB.toString(),
      swapSize.mul(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(aTokenDecimals))).toString(),
    );
    basePrice = wadMul(targetPrice.toString(), quotePrice.toString()).toString();
  } else {
    // (amountA * mulA) / (amountB * mulB) * quotePrice
    const targetPrice = wadDiv(
      swapSize.mul(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(aTokenDecimals))).toString(),
      amountOutB.toString(),
    ).toString();
    basePrice = wadMul(targetPrice, quotePrice.toString()).toString();
  }
  await priceFeedUpdaterTestService.updatePriceFeed(
    basePriceFeed,
    BigNumber.from(basePrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub("8"))),
  );
  return amountOutB.div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(bTokenDecimals)));
}

async function taskSetup({ depositAsset = "usdc", positionAsset = "wbtc", depositAmount = "300", borrowedAmount = "200" }) {
  const { deployer } = await getNamedSigners();
  const bestDexLens = await getContract("BestDexLens");
  const positionManager = await getContract("PositionManager");
  const bucket = await getContract("Primex Bucket USDC");
  const dexWithAncillaryData = await getDexWithAncillaryData();
  const priceOracle = await getContract("PriceOracle");

  const dex = "uniswap";
  if (!assets[depositAsset] || !assets[positionAsset]) {
    throw new Error("Incorrect asset");
  }
  const depositToken = await getContractAt("ERC20", assets[depositAsset]);
  const positionToken = await getContractAt("ERC20", assets[positionAsset]);
  const borrowedToken = await getContractAt("ERC20", assets.usdc);

  const depositDecimals = await depositToken.decimals();
  const positionDecimals = await positionToken.decimals();
  const borrowedDecimals = await borrowedToken.decimals();

  // const depositTokenmultiplier = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(depositDecimals));
  const positionTokenMultiplier = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(positionDecimals));
  const borrowedTokenMultiplier = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(borrowedDecimals));

  depositAmount = parseUnits(depositAmount, depositDecimals);
  borrowedAmount = parseUnits(borrowedAmount, borrowedDecimals);

  const primexPricingLibrary = await getContract("PrimexPricingLibrary");

  const swapSize = depositToken === borrowedToken ? depositAmount.add(borrowedAmount) : borrowedAmount;
  let leverage;
  if (depositToken === borrowedToken) {
    leverage = depositAmount.add(borrowedAmount).div(depositAmount);
  } else {
    const { returnAmount: depositInPositionAsset } = await bestDexLens.callStatic.getBestMultipleDexes({
      positionManager: positionManager.address,
      assetToBuy: positionToken.address,
      assetToSell: depositToken.address,
      amount: depositAmount,
      isAmountToBuy: false,
      shares: 1,
      gasPriceInCheckedAsset: 0,
      dexes: dexWithAncillaryData,
    });

    let borrowedAmountInPositionAsset;
    if (borrowedAmount.gt(Zero)) {
      ({ returnAmount: borrowedAmountInPositionAsset } = await bestDexLens.callStatic.getBestMultipleDexes({
        positionManager: positionManager.address,
        assetToBuy: positionToken.address,
        assetToSell: borrowedToken.address,
        amount: borrowedAmount,
        isAmountToBuy: false,
        shares: 1,
        gasPriceInCheckedAsset: 0,
        dexes: dexWithAncillaryData,
      }));
    } else {
      borrowedAmountInPositionAsset = Zero;
    }

    leverage = wadDiv(borrowedAmountInPositionAsset.add(depositInPositionAsset), depositInPositionAsset);
  }
  const maxLeverage = await bucket.maxAssetLeverage(positionToken.address);
  if (leverage.gt(maxLeverage)) {
    throw new Error(`Too large leverage. Max leverage is ${maxLeverage.toString()}`);
  }

  await setCorrectOraclePrice({
    swapSize: swapSize,
    dex: dex,
    tokenA: borrowedToken.address,
    tokenB: positionToken.address,
    aTokenDecimals: borrowedDecimals,
    bTokenDecimals: positionDecimals,
  });
  let swapInBorrowedAsset;
  if (depositToken.address === borrowedToken.address) {
    swapInBorrowedAsset = depositAmount.add(borrowedAmount);
  } else {
    const depositAmountInBorrowed = await primexPricingLibrary.getOracleAmountsOut(
      depositToken.address,
      borrowedToken.address,
      depositAmount,
      priceOracle.address,
    );
    swapInBorrowedAsset = borrowedAmount.add(depositAmountInBorrowed);
  }
  // _asset, _minPositionAsset, _amount, _priceOracle
  const positionSizeByOracle = await primexPricingLibrary.getOracleAmountsOut(
    borrowedToken.address,
    await positionManager.minPositionAsset(),
    swapInBorrowedAsset,
    priceOracle.address,
  );
  const minPosition = await positionManager.minPositionSize();
  if (positionSizeByOracle.lt(minPosition)) {
    throw new Error(`Insufficient position size. The min position is ${minPosition.toString()}, now ${positionSizeByOracle.toString()}`);
  }
  /// /////////////////////////////////////////////////
  const traderBalanceVault = await getContract("TraderBalanceVault");
  await depositToken.approve(traderBalanceVault.address, depositAmount);
  await traderBalanceVault.deposit(depositToken.address, depositAmount);

  await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: parseUnits("1", "ether") });
  /// ///////////////////////////
  const bucketLiquidity = await borrowedToken.balanceOf(bucket.address);
  if (bucketLiquidity.lt(borrowedAmount)) {
    await borrowedToken.approve(bucket.address, borrowedAmount.sub(bucketLiquidity));
    await bucket.deposit(deployer.address, borrowedAmount.sub(bucketLiquidity), true);
  }
  /// /////////////////////////////
  const setup = {
    depositTokenAddress: depositToken.address,
    borrowedTokenAddress: borrowedToken.address,
    positionTokenAddress: positionToken.address,
    bucketAddress: bucket.address,
    borrowedTokenMultiplier: borrowedTokenMultiplier,
    positionTokenMultiplier: positionTokenMultiplier,
    depositAmount: depositAmount,
    borrowedAmount: borrowedAmount,
  };
  console.log("----------------------");
  console.log("Task setup is complete!");
  console.log("----------------------");

  return setup;
}

async function getDexWithAncillaryData() {
  const dexWithAncillaryData = [
    {
      dex: "uniswap",
      ancillaryData: HashZero,
    },
    {
      dex: "sushiswap",
      ancillaryData: HashZero,
    },
  ];

  for (const univ3Fee of ["10000", "3000", "500"]) {
    dexWithAncillaryData.push({
      dex: "uniswapv3",
      ancillaryData: hexZeroPad(BigNumber.from(univ3Fee).toHexString(), 32),
    });
  }

  // Some networks may not have curve or balancer.
  // This is normal and try catch is set so that the script does not break in these cases
  try {
    const curvePools = require(`../../deployments/${network.name}/CurvePools.json`);
    for (const poolName in curvePools) {
      dexWithAncillaryData.push({ dex: "curve", ancillaryData: hexZeroPad(curvePools[poolName].pool, 32) });
    }
  } catch {}

  try {
    const balancerPools = require(`../../deployments/${network.name}/BalancerPools.json`);
    for (const poolName in balancerPools) {
      dexWithAncillaryData.push({ dex: "balancer", ancillaryData: balancerPools[poolName].poolId });
    }
  } catch {}
  return dexWithAncillaryData;
}

async function swapAtoB(assetA = "usdc", assetB = "wbtc", amount = "200", dex = "uniswap") {
  const primexDNS = await getContract("PrimexDNS");
  const testTokenA = await getContractAt("ERC20", assets[assetA]);
  const testTokenB = await getContractAt("ERC20", assets[assetB]);
  const decimalsB = await testTokenB.decimals();

  const router = (await primexDNS.dexes(dex)).routerAddress;
  await run("router:swapExactTokensForTokens", {
    router: router,
    from: "deployer",
    to: "deployer",
    amountIn: parseUnits(amount, decimalsB).toString(),
    path: [testTokenA.address, testTokenB.address].toString(),
  });
}

async function getTraderPositions() {
  const positionManager = await getContract("PositionManager");
  const primexLens = await getContract("PrimexLens");
  const { deployer } = await getNamedSigners();
  const { positionsData } = await primexLens.getArrayOpenPositionDataByTrader(positionManager.address, deployer.address, 0, 100);
  console.log("-----------------");
  console.log("Current positions:");
  for (let i = 0; i < positionsData.length; i++) {
    console.log("id = ", positionsData[i].id.toString());
  }
  console.log("-----------------");
  const w = await positionManager.positionsId();
  return w.sub(1);
}

module.exports = { taskSetup, swapAtoB, setCorrectOraclePrice, getTraderPositions, getDexWithAncillaryData };
