// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PriceOracle", "Deploy PriceOracle contract", require("./priceOracle.deploy"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addParam("eth", "Eth address")
  .addParam("uniswapPriceFeed", "Address of the UniswapPriceFeed")
  .addParam("pyth", "Address of the PythOracle")
  .addOptionalParam("usdt", "Address of the USDT")
  .addOptionalParam("supraPullOracle", "Address of the Supra pull contract")
  .addOptionalParam("supraStorageOracle", "Address of the Supra storage contract")
  .addOptionalParam("treasury", "Address of the Treasury contract");

task("priceOracle:updateChainlinkPriceFeedsUsd", " Update chainlinkPriceFeedsUsd in priceOracle", require("./updatePriceFeed"))
  .addOptionalParam("priceOracle", "The address of priceOracle contract")
  .addParam("updatePriceFeeds", "Object with {tokens: [], feeds: []} to update pricefeed in priceOracle");

task("priceOracle:updatePriceDropFeed", " Update priceDropfeeds in priceOracle", require("./updatePriceDropFeed"))
  .addOptionalParam("priceOracle", "The address of priceOracle contract")
  .addParam("updatePriceDropFeeds", "Array with struct {token0,token1,priceDropFeed} to update priceDropFeed in priceOracle");

task("priceOracle:updateFeedsFromConfig", " Update priceDropfeeds in priceOracle", require("./updateFeedsFromConfig")).addOptionalParam(
  "priceOracle",
  "The address of priceOracle contract",
);
