// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexTimelock", "Deploy PrimexTimelock contract", require("./PrimexTimelock.deploy.js"))
  .addParam("registry", "The address of registry contract")
  .addParam("minDelay", "Minimal delay of operation for execute in this timelock")
  .addOptionalParam("proposers", "The address of registry contract", "[]")
  .addOptionalParam("executors", "The address of registry contract", "[]")
  .addOptionalParam("admin", "Optional account to be granted admin role(default address zero)")
  .addOptionalParam("deploymentName", "Name of deployment artifact", "PrimexTimelock")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
