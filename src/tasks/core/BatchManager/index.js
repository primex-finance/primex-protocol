// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:BatchManager", "Deploy PositionManager contract", require("./batchManager.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("positionLibrary", "The address of PositionLibrary library")
  .addParam("positionManager", "The address of the PositionManager")
  .addParam("priceOracle", "The address of the PriceOracle")
  .addParam("tokenTransfersLibrary", "The address of the TokenTransfersLibrary")
  .addParam("whiteBlackList", "The address of the WhiteBlackList")
  .addParam("gasPerPosition", "The gas amount per position")
  .addParam("gasPerBatch", "The gas amount per batch")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addFlag("notExecuteNewDeployedTasks", "Whether to ignore the newDeployed if statement");
