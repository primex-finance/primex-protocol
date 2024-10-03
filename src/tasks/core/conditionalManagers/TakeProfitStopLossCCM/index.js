// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:TakeProfitStopLossCCM", "Deploy TakeProfitStopLossCCM contract", require("./TakeProfitStopLossCCM.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("positionLibrary", "The address of PositionLibrary library")
  .addParam("registry", "The address of the Registry contract")
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("priceOracle", "The address of priceOracle contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
