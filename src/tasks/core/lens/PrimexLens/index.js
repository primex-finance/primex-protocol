// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexLens", "Deploy PrimexLens contract", require("./primexLens.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("positionLibrary", "The address of PositionLibrary library")
  .addParam("limitOrderLibrary", "The address of LimitOrderLibrary library")
  .addParam("takeProfitStopLossCCM", "The address of TakeProfitStopLossCCM contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
