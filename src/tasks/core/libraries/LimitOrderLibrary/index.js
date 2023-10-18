// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:LimitOrderLibrary", "Deploy LimitOrderLibrary", require("./LimitOrderLibrary.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
