// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexLensPart2", "Deploy PrimexLensPart2 contract", require("./primexLensPart2.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("primexLens", "The address of primexLens contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
