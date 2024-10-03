// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:UniswapPriceFeed", "Deploy PriceOracle contract", require("./uniswapPriceFeed.deploy"))
  .addParam("uniswapV3Factory", "The address of the uniswap factory")
  .addParam("twapInterval", "The TWAP interval in seconds")
  .addParam("poolUpdateInterval", "The pool update interval in seconds")
  .addParam("registry", "The address of the PrimexRegistry");
