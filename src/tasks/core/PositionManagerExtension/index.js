// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PositionManagerExtension", "Deploy PositionManagerExtension contract", require("./PositionManagerExtension.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("positionLibrary", "The address of PositionLibrary library");
