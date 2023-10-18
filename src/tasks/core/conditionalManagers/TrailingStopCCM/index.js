// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:TrailingStopCCM", "Deploy TrailingStopCCM contract", require("./TrailingStopCCM.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("positionLibrary", "The address of PositionLibrary library")
  .addParam("priceOracle", "The address of priceOracle contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
