// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: { getContract },
  deployments: { fixture },
} = require("hardhat");

process.env.TEST = true;

describe("PriceOracle_integration", function () {
  let testTokenA, testTokenB, ErrorsLibrary;
  let priceOracle, mockPriceFeed;

  beforeEach(async function () {
    await fixture(["Test"]);
    testTokenA = await getContract("TestTokenA");
    testTokenB = await getContract("TestTokenB");
    priceOracle = await getContract("PriceOracle");
    ErrorsLibrary = await getContract("Errors");
    mockPriceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
  });

  describe("Price oracle Contract tests", function () {
    beforeEach(async function () {
      priceOracle = await getContract("PriceOracle");
    });

    it("set price in chainLink and get with oracle", async function () {
      await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, mockPriceFeed.address);

      const isForward = true;
      const answerDecimals = "8";
      const ethUsdExchangeRate = "432043695902"; // 1 eth = $4320,43 with decimals 8
      await mockPriceFeed.setAnswer(ethUsdExchangeRate);
      await mockPriceFeed.setDecimals(answerDecimals);
      const [exchangeRate, direction] = await priceOracle.getExchangeRate(testTokenA.address, testTokenB.address);
      const answer = "4320436959020000000000"; // 1 eth = $4320,43 with decimals 8

      expect(exchangeRate).to.equal(answer);
      expect(direction).to.equal(isForward);
      expect(await priceOracle.getDirectPriceFeed(testTokenA.address, testTokenB.address)).to.equal(mockPriceFeed.address);

      // bad answer case
      const badAnswer = "-1";
      await mockPriceFeed.setAnswer(badAnswer);
      await expect(priceOracle.getExchangeRate(testTokenA.address, testTokenB.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_EXCHANGE_RATE",
      );
    });

    it("set fractional price in chainLink and get with oracle", async function () {
      await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, mockPriceFeed.address);
      const ethUsdExchangeRate = "137399822207346400"; // 1 BNB = 0.1373 ETH
      const answerDecimals = "18";
      await mockPriceFeed.setAnswer(ethUsdExchangeRate);
      await mockPriceFeed.setDecimals(answerDecimals);

      const isForwardAB = false;
      let [exchangeRate, direction] = await priceOracle.getExchangeRate(testTokenA.address, testTokenB.address);
      expect(exchangeRate).to.equal(ethUsdExchangeRate);
      expect(direction).to.equal(isForwardAB);

      const isForwardBA = true;
      [exchangeRate, direction] = await priceOracle.getExchangeRate(testTokenB.address, testTokenA.address);
      expect(exchangeRate).to.equal(ethUsdExchangeRate);
      expect(direction).to.equal(isForwardBA);
    });

    it("Should set gas price feed and return gas price from it", async function () {
      await priceOracle.setGasPriceFeed(mockPriceFeed.address);
      const gasPrice = "1000";
      await mockPriceFeed.setAnswer(gasPrice);

      expect(await priceOracle.getGasPrice()).to.equal(gasPrice);
    });
  });
});
