// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Redeemer", "Deploy Redeemer contract", require("./Redeemer.deploy"))
  .addParam("earlyPmx", "Address of the EarlyPmxToken contract")
  .addParam("pmx", "Address of the PmxToken contract")
  .addParam("tokenTransfersLibrary", "The address of the TokenTransfersLibrary")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
