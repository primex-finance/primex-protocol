// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:BatchManager", "Deploy PositionManager contract", require("./batchManager.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("positionLibrary", "The address of PositionLibrary library")
  .addParam("positionManager", "The address of the PositionManager")
  .addParam("priceOracle", "The address of the PriceOracle")
  .addParam("whiteBlackList", "The address of the WhiteBlackList")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("contractName", "The name of the contract artifact e.g BatchManager");
