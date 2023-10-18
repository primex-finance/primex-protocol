// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PriceFeedUpdaterTestService", "Deploy PriceFeedUpdaterTestService contract", require("./PriceFeedUpdaterTestService.deploy"))
  .addOptionalParam("updater", "The address that can update prices in the price feed")
  .addParam("dexAdapter", "The address of dex adapter")
  .addParam("routers", "The router addresses where to look for the prices of tokens")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
