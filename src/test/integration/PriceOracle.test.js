// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    provider,
    getContract,
    utils: { parseEther, parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");

process.env.TEST = true;
const { addLiquidity, swapExactTokensForTokens } = require("../utils/dexOperations");
const { BigNumber } = require("ethers");
const { wadMul, wadDiv } = require("../utils/bnMath");
const { MAX_TOKEN_DECIMALITY, USD, WAD } = require("../utils/constants");
const {
  getEncodedChainlinkRouteToUsd,
  getEncodedChainlinkRouteToToken,
  getEncodedUniswapRouteToToken,
  getEncodedPythRouteToToken,
  getEncodedPythRouteToUsd,
} = require("../utils/oracleUtils");

describe("PriceOracle_integration", function () {
  let testTokenA, testTokenB, ErrorsLibrary;
  let priceOracle, mockPriceFeed;
  let uniswapPriceFeed, pyth;

  before(async function () {
    await fixture(["Test"]);
    testTokenA = await getContract("TestTokenA");
    testTokenB = await getContract("TestTokenB");
    priceOracle = await getContract("PriceOracle");
    ErrorsLibrary = await getContract("Errors");
    uniswapPriceFeed = await getContract("UniswapPriceFeed");
    pyth = await getContract("MockPyth");
    mockPriceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
  });

  describe("Price oracle Contract tests", function () {
    beforeEach(async function () {
      priceOracle = await getContract("PriceOracle");
    });

    it("set price in chainLink and get with oracle", async function () {
      await priceOracle.updateChainlinkPriceFeedsUsd([testTokenA.address], [mockPriceFeed.address]);
      const oracleData = getEncodedChainlinkRouteToUsd();

      const answerDecimals = "8";
      const ethUsdExchangeRate = "432043695902"; // 1 eth = $4320,43 with decimals 8
      await mockPriceFeed.setAnswer(ethUsdExchangeRate);
      await mockPriceFeed.setDecimals(answerDecimals);
      const exchangeRate = await priceOracle.callStatic.getExchangeRate(testTokenA.address, USD, oracleData);
      const answer = "4320436959020000000000"; // 1 eth = $4320,43 with decimals 18
      expect(exchangeRate).to.equal(answer);

      // bad answer case
      const badAnswer = "-1";
      await mockPriceFeed.setAnswer(badAnswer);
      await expect(priceOracle.callStatic.getExchangeRate(testTokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_EXCHANGE_RATE",
      );
    });

    it("set fractional price in chainLink and get with oracle", async function () {
      await priceOracle.updateChainlinkPriceFeedsUsd([testTokenA.address], [mockPriceFeed.address]);
      let oracleData = getEncodedChainlinkRouteToUsd();

      const ethUsdExchangeRate = "137399822207346400"; // 1 BNB = 0.1373 ETH
      const answerDecimals = "18";
      await mockPriceFeed.setAnswer(ethUsdExchangeRate);
      await mockPriceFeed.setDecimals(answerDecimals);

      const exchangeRate = await priceOracle.callStatic.getExchangeRate(testTokenA.address, USD, oracleData);
      expect(exchangeRate).to.equal(ethUsdExchangeRate);

      oracleData = getEncodedChainlinkRouteToToken(testTokenA);
      const invertExchangeRate = await priceOracle.callStatic.getExchangeRate(USD, testTokenA.address, oracleData);
      expect(invertExchangeRate).to.equal(wadDiv(WAD, ethUsdExchangeRate));
    });

    it("Should set gas price feed and return gas price from it", async function () {
      await priceOracle.setGasPriceFeed(mockPriceFeed.address);
      const gasPrice = "1000";
      await mockPriceFeed.setAnswer(gasPrice);

      expect(await priceOracle.getGasPrice()).to.equal(gasPrice);
    });
  });

  describe("Price oracle Contract tests with UniswapPriceFeed", function () {
    let decimalsA, decimalsB;
    let multiplierA, multiplierB;

    before(async function () {
      await addLiquidity({ dex: "uniswapv3", from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await swapExactTokensForTokens({ dex: "uniswapv3", amountIn: parseEther("1"), path: [testTokenA.address, testTokenB.address] });

      const currentTimestamp = (await provider.getBlock("latest")).timestamp + 1900;

      await network.provider.send("evm_setNextBlockTimestamp", [currentTimestamp]);

      await uniswapPriceFeed.updatePool(testTokenA.address, testTokenB.address, 0);

      await priceOracle.updateUniv3TypeOracle([0], [uniswapPriceFeed.address]);
      await priceOracle.updateUniv3TrustedPair([
        {
          oracleType: 0,
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          isTrusted: true,
        },
      ]);

      decimalsA = await testTokenA.decimals();
      decimalsB = await testTokenB.decimals();
      multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    });

    it("get correct price with UniswapPriceFeed tokenA/tokenB", async function () {
      const amountA = parseEther("2", decimalsA);
      const oracleData = getEncodedUniswapRouteToToken(testTokenB);

      const exchangeRate = await priceOracle.callStatic.getExchangeRate(testTokenA.address, testTokenB.address, oracleData);

      const spotQuote = await uniswapPriceFeed.callStatic.getQuote(amountA, testTokenA.address, testTokenB.address, 60);

      // check that amountA * exchangeRate is the quote amount;
      expect(wadMul(amountA.mul(multiplierA), exchangeRate).div(multiplierB)).to.be.closeTo(spotQuote, "1", "rounding");
    });

    it("get correct price with UniswapPriceFeed for tokenB/tokenA", async function () {
      const oracleData = getEncodedUniswapRouteToToken(testTokenA);

      const amountB = parseUnits("2", decimalsB);

      const exchangeRate = await priceOracle.callStatic.getExchangeRate(testTokenB.address, testTokenA.address, oracleData);
      const spotQuote = await uniswapPriceFeed.callStatic.getQuote(amountB, testTokenB.address, testTokenA.address, 60);

      // check that amountA * exchangeRate is the quote amount;
      expect(wadMul(amountB.mul(multiplierB), exchangeRate).div(multiplierA)).to.be.closeTo(spotQuote, "1", "rounding");
    });
  });
  describe("Price oracle Contract tests with Pyth", function () {
    const priceFeedID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
    const expo = -8;
    let price;
    let updateData;
    before(async function () {
      await priceOracle.updatePythPairId([testTokenA.address], [priceFeedID]);
      await priceOracle.setTimeTolerance("60");
      // price in 10**8
      price = BigNumber.from("1500");
      const publishTime = (await provider.getBlock("latest")).timestamp + 1;
      updateData = await pyth.createPriceFeedUpdateData(
        priceFeedID,
        price.mul(BigNumber.from("10").pow(expo * -1)),
        0,
        expo, // expo
        0,
        0,
        publishTime,
        0,
      );
    });
    it("Should not revert when pullOracleData is empty", async function () {
      expect(
        await priceOracle.updatePullOracle([], {
          value: 1,
        }),
      );
    });

    it("Should revert when the value is less than necessary", async function () {
      await expect(
        priceOracle.updatePullOracle([updateData], {
          value: 0,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NOT_ENOUGH_MSG_VALUE");
    });

    it("get correct price with Pyth tokenA/USD", async function () {
      const oracleData = getEncodedPythRouteToUsd();
      await priceOracle.updatePullOracle([updateData], {
        value: 1,
      });

      const amount = await priceOracle.callStatic.getExchangeRate(testTokenA.address, USD, oracleData);
      expect(amount).to.be.equal(price.mul(BigNumber.from("10").pow("18")));
    });
    it("get correct price with Pyth USD/tokenA", async function () {
      const oracleData = getEncodedPythRouteToToken(testTokenA);
      await priceOracle.updatePullOracle([updateData], {
        value: 1,
      });

      const amount = await priceOracle.callStatic.getExchangeRate(USD, testTokenA.address, oracleData);
      expect(amount).to.be.equal(wadDiv(WAD, price.mul(BigNumber.from("10").pow("18"))));
    });
  });
});
