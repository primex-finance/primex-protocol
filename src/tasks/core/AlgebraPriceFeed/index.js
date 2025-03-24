// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:AlgebraPriceFeed", "Deploy PriceOracle contract", require("./algebraPriceFeed.deploy"))
  .addParam("algebraV3Factory", "The address of the algebra factory")
  .addParam("twapInterval", "The TWAP interval in seconds")
  .addParam("registry", "The address of the PrimexRegistry");
