// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PriceOracle", "Deploy PriceOracle contract", require("./priceOracle.deploy"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addParam("eth", "Eth address");

task("priceOracle:updatePriceFeed", " Update pricefeeds in priceOracle", require("./updatePriceFeed"))
  .addOptionalParam("priceOracle", "The address of priceOracle contract")
  .addParam("updatePriceFeeds", "Array with struct {token0,token1,priceFeed} to update pricefeed in priceOracle");

task("priceOracle:updatePriceDropFeed", " Update priceDropfeeds in priceOracle", require("./updatePriceDropFeed"))
  .addOptionalParam("priceOracle", "The address of priceOracle contract")
  .addParam("updatePriceDropFeeds", "Array with struct {token0,token1,priceDropFeed} to update priceDropFeed in priceOracle");

task("priceOracle:updateFeedsFromConfig", " Update priceDropfeeds in priceOracle", require("./updateFeedsFromConfig")).addOptionalParam(
  "priceOracle",
  "The address of priceOracle contract",
);
