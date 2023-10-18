// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "deploy:SynchronizationBotLensUniV3",
  "Deploy SynchronizationBotLensUniV3TestService contract",
  require("./SynchronizationBotLensUniV3TestService.deploy"),
).addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library");
