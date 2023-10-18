// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "deploy:SynchronizationBotLensQuickswap",
  "Deploy SynchronizationBotLensQuickswapTestService contract",
  require("./SynchronizationBotLensQuickswapTestService.deploy"),
).addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library");
