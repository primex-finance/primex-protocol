// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Treasury", "Deploy Treasury contract", require("./Treasury.deploy"))
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("tokenTransfersLibrary", "The address of the TokenTransfersLibrary")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task(
  "treasury:setTreasurySpendersByConfig",
  "Set spender and his transfer restriction by config",
  require("./setTreasurySpendersByConfig"),
);
