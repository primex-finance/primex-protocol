// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:BestDexLens", "Deploy BestDexLens contract", require("./bestDexLens.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
