// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexPricingLibrary", "Deploy PrimexPricingLibrary", require("./PrimexPricingLibrary.deploy"))
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addParam("errorsLibrary", "The address of errorsLibrary contract");
