// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexProxyAdmin", "Deploy PrimexTimelock contract", require("./PrimexProxyAdmin.deploy.js"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
