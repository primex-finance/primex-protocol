// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Reserve", "Deploy Reserve contract", require("./Reserve.deploy"))
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("registry", "The address of the Registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task(
  "reserve:setTransferRestrictionsByConfig",
  "Set transfer restriction ptokens to treasury by config",
  require("./setTransferRestrictionsByConfig"),
);
