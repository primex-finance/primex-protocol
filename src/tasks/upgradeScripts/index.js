// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task(
  "checkUpdateScripts",
  "Script that first deploy the contract mocks and then checks if the upgrades are correct",
  require("./upgradeContracts"),
)
  .addFlag("deployContracts", "The flag to indicate whether new versions of contracts should be deployed")
  .addFlag("executeUpgrade", "The flag to indicate whether contract updates should be executed");

task("scheduleBatchContractUpgrade", "Schedule batch contract upgrade", require("./scheduleBatchContractUpgrade")).addParam(
  "params",
  "The array of contracts params to be upgraded",
);
