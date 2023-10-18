// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "deploy:PrimexAggregatorV3TestService",
  "Deploy PrimexAggregatorV3TestService contract",
  require("./primexAggregatorV3TestService.deploy"),
)
  .addOptionalParam("updater", "The address that can update prices in the price feed")
  .addParam("name", "Price feed name", "TEST");
