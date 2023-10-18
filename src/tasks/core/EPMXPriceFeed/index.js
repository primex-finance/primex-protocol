// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:EPMXPriceFeed", "Deploy EPMXPriceFeed contract", require("./EPMXPriceFeed.deploy"))
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("price", "The price of EPMX in USD");
