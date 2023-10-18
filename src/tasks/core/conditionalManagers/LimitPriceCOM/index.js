// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:LimitPriceCOM", "Deploy LimitPriceCOM contract", require("./LimitPriceCOM.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("limitOrderLibrary", "The address of LimitOrderLibrary library")
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("priceOracle", "The address of priceOracle contract")
  .addParam("positionManager", "The address of PositionManager contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
