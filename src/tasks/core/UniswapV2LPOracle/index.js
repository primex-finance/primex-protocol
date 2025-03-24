// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:UniswapV2LPOracle", "Deploy PriceOracle contract", require("./UniswapV2LPOracle.deploy")).addParam(
  "priceOracle",
  "The address of the PriceOracle contract",
);
