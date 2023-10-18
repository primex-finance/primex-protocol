// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexUpkeep", "Deploy PrimexUpkeep contract", require("./PrimexUpkeep.deploy"))
  .addParam("positionManager", "The address of position manager contract")
  .addParam("limitOrderManager", "The address of limit order manager contract")
  .addParam("registry", "The address of registry contract")
  .addParam("bestDexLens", "The address of best dex lens contract")
  .addParam("primexLens", "The address of primexLens contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
