// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    BigNumber,
    utils: { parseUnits, parseEther, defaultAbiCoder },
    getNamedSigners,
  },
} = require("hardhat");
const { wadDiv, wadMul, WAD } = require("./bnMath");
const { USD_DECIMALS, USD, USD_MULTIPLIER, OracleType, NATIVE_CURRENCY } = require("./constants");

const decodeParams = ["(address,uint8,bytes)[]"];
const fivePercent = parseEther("0.05");

async function setupUsdOraclesForTokens(tokenA, tokenB, targetABPrice, priceOracle) {
  const { deployer } = await getNamedSigners();
  if (!priceOracle) {
    priceOracle = await getContract("PriceOracle");
  }
  const eth = await priceOracle.eth();
  const tokenAIsEth = tokenA === eth;
  const tokenBIsEth = tokenB === eth;
  const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
  const tokenAPriceFeed = await PrimexAggregatorV3TestServiceFactory.deploy(
    `${tokenAIsEth ? "ETH" : await tokenA.symbol()}_USD`,
    deployer.address,
  );
  const tokenBPriceFeed = await PrimexAggregatorV3TestServiceFactory.deploy(
    `${tokenBIsEth ? "ETH" : await tokenB.symbol()}_USD`,
    deployer.address,
  );
  await tokenAPriceFeed.setDecimals(USD_DECIMALS);
  await tokenAPriceFeed.setAnswer(parseUnits("1", USD_DECIMALS));
  await tokenBPriceFeed.setDecimals(USD_DECIMALS);

  const price = wadDiv(parseUnits("1", USD_DECIMALS).toString(), targetABPrice.toString()).toString();
  await tokenBPriceFeed.setAnswer(BigNumber.from(price).div(USD_MULTIPLIER));
  await priceOracle.updateChainlinkPriceFeedsUsd(
    [tokenAIsEth ? eth : tokenA.address, tokenBIsEth ? eth : tokenB.address],
    [tokenAPriceFeed.address, tokenBPriceFeed.address],
  );
}

async function setupUsdOraclesForToken(token, price, priceOracle) {
  const { deployer } = await getNamedSigners();
  if (!priceOracle) {
    priceOracle = await getContract("PriceOracle");
  }
  const tokenIsNative = token === NATIVE_CURRENCY;
  const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
  const tokenPriceFeed = await PrimexAggregatorV3TestServiceFactory.deploy(
    `${tokenIsNative ? "ETH" : await token.symbol()}_USD`,
    deployer.address,
  );
  await tokenPriceFeed.setDecimals(USD_DECIMALS);
  await tokenPriceFeed.setAnswer(price);
  await priceOracle.updateChainlinkPriceFeedsUsd([tokenIsNative ? NATIVE_CURRENCY : token.address], [tokenPriceFeed.address]);
}

async function setPriceBetweenAB(tokenA, tokenB, price, priceOracle) {
  if (!priceOracle) {
    priceOracle = await getContract("PriceOracle");
  }
  const tokenAPriceFeed = await getContractAt("PrimexAggregatorV3TestService", await priceOracle.chainlinkPriceFeedsUsd(tokenA.address));
  const tokenBPriceFeed = await getContractAt("PrimexAggregatorV3TestService", await priceOracle.chainlinkPriceFeedsUsd(tokenB.address));
  const tokenAUsdPrice = await tokenAPriceFeed.latestAnswer();
  await tokenBPriceFeed.setAnswer(BigNumber.from(wadDiv(tokenAUsdPrice.toString(), price.toString()).toString()).div(USD_MULTIPLIER));
}

async function getEncodedChainlinkRouteViaUsd(tokenB, priceOracle) {
  if (!priceOracle) {
    priceOracle = await getContract("PriceOracle");
  }
  const eth = await priceOracle.eth();
  const tokenBIsEth = tokenB === eth;
  return defaultAbiCoder.encode(decodeParams, [
    [
      [USD, OracleType.Chainlink, []],
      [tokenBIsEth ? eth : tokenB.address, OracleType.Chainlink, []],
    ],
  ]);
}
function getEncodedChainlinkRouteToUsd() {
  return defaultAbiCoder.encode(decodeParams, [[[USD, OracleType.Chainlink, []]]]);
}
function getEncodedUniswapRouteToUsd() {
  return defaultAbiCoder.encode(decodeParams, [[[USD, OracleType.Uniswapv3, []]]]);
}

function getEncodedPythRouteToUsd() {
  return defaultAbiCoder.encode(decodeParams, [[[USD, OracleType.Pyth, []]]]);
}

function getEncodedSupraRouteToUsd() {
  return defaultAbiCoder.encode(decodeParams, [[[USD, OracleType.Supra, []]]]);
}

function getEncodedChainlinkRouteToToken(tokenB) {
  return defaultAbiCoder.encode(decodeParams, [[[tokenB.address, OracleType.Chainlink, []]]]);
}

function getEncodedUniswapRouteToToken(tokenB) {
  return defaultAbiCoder.encode(decodeParams, [[[tokenB.address, OracleType.Uniswapv3, []]]]);
}

function getEncodedPythRouteToToken(tokenB) {
  return defaultAbiCoder.encode(decodeParams, [[[tokenB.address, OracleType.Pyth, []]]]);
}
function getEncodedSupraRouteToToken(tokenB) {
  return defaultAbiCoder.encode(decodeParams, [[[tokenB.address, OracleType.Supra, []]]]);
}

async function setOraclePrice(tokenA, tokenB, price) {
  const priceOracle = await getContract("PriceOracle");
  const tokenAPriceFeed = await getContractAt("PrimexAggregatorV3TestService", await priceOracle.chainlinkPriceFeedsUsd(tokenA.address));
  const tokenBPriceFeed = await getContractAt("PrimexAggregatorV3TestService", await priceOracle.chainlinkPriceFeedsUsd(tokenB.address));
  const tokenAUsdPrice = await tokenAPriceFeed.latestAnswer();
  price = wadDiv(tokenAUsdPrice.toString(), price.toString()).toString();
  await tokenBPriceFeed.setAnswer(BigNumber.from(price).div(USD_MULTIPLIER));
}

async function setBadOraclePrice(tokenA, tokenB, additionalPercentage = fivePercent, oracleTolerableLimit) {
  const priceOracle = await getContract("PriceOracle");
  const positionManager = await getContract("PositionManager");
  oracleTolerableLimit = oracleTolerableLimit ?? (await positionManager.defaultOracleTolerableLimit());
  const tokenAPriceFeed = await getContractAt("PrimexAggregatorV3TestService", await priceOracle.chainlinkPriceFeedsUsd(tokenA.address));
  const tokenBPriceFeed = await getContractAt("PrimexAggregatorV3TestService", await priceOracle.chainlinkPriceFeedsUsd(tokenB.address));
  const tokenAUsdPrice = await tokenAPriceFeed.latestAnswer();
  const tokenBUsdPrice = await tokenBPriceFeed.latestAnswer();
  const correctPrice = wadDiv(tokenAUsdPrice.toString(), tokenBUsdPrice.toString()).toString();
  const badPrice = BigNumber.from(
    wadDiv(correctPrice.toString(), BigNumber.from(WAD).sub(oracleTolerableLimit.add(additionalPercentage)).toString()).toString(),
  ).div(USD_MULTIPLIER);
  const price = wadDiv(tokenAUsdPrice.toString(), badPrice.toString()).toString();
  await tokenBPriceFeed.setAnswer(BigNumber.from(price).div(USD_MULTIPLIER));
}
function getEncodedRoutes(routes) {
  return defaultAbiCoder.encode(decodeParams, [routes]);
}

function reversePrice(price) {
  return BigNumber.from(wadDiv(parseUnits("1", USD_DECIMALS).toString(), price).toString()).div(USD_MULTIPLIER);
}

async function getExchangeRateByRoutes(assetA, oracleData) {
  const priceOracle = await getContract("PriceOracle");
  const decodeData = defaultAbiCoder.decode(decodeParams, oracleData)[0];

  let tokenFrom = assetA.address;
  let price = WAD;

  for (let i = 0; i < decodeData.length; i++) {
    price = wadMul(
      price,
      await _getExchangeRate(
        tokenFrom,
        { tokenTo: decodeData[i][0], oracleType: decodeData[i][1], oracleData: decodeData[i][2] },
        priceOracle,
      ),
    );
    tokenFrom = decodeData[i][0];
  }
  return price;
}

async function _getExchangeRate(tokenFrom, oracleData, priceOracle) {
  const tokenFromIsUsd = tokenFrom === USD;
  if (oracleData.oracleType === OracleType.Chainlink) {
    const priceFeed = await getContractAt(
      "PrimexAggregatorV3TestService",
      await priceOracle.chainlinkPriceFeedsUsd(tokenFromIsUsd ? oracleData.tokenTo : tokenFrom),
    );
    const tokenPrice = await priceFeed.latestAnswer();
    if (tokenPrice.lte(0)) throw new Error("ZERO EXCHANGE RATE");
    return tokenFromIsUsd ? wadDiv(WAD, tokenPrice.mul(USD_MULTIPLIER)) : tokenPrice.mul(USD_MULTIPLIER);
  }
}

module.exports = {
  setPriceBetweenAB,
  setOraclePrice,
  fivePercent,
  reversePrice,
  getEncodedRoutes,
  setupUsdOraclesForToken,
  getEncodedChainlinkRouteToToken,
  getEncodedPythRouteToToken,
  getEncodedPythRouteToUsd,
  getExchangeRateByRoutes,
  getEncodedUniswapRouteToToken,
  getEncodedUniswapRouteToUsd,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setBadOraclePrice,
  getEncodedSupraRouteToUsd,
  getEncodedSupraRouteToToken,
};
