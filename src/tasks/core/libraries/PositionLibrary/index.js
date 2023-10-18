// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PositionLibrary", "Deploy PositionLibrary", require("./PositionLibrary.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addParam("limitOrderLibrary", "The address of LimitOrderLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
