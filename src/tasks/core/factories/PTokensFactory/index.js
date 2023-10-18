// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PTokensFactory", "Deploy PTokensFactory contract", require("./PTokensFactory.deploy"))
  .addOptionalParam("ptokenImplementation", "The address of PToken contract")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("primexProxyAdmin", "The address of the PrimexProxyAdmin")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task("deploy:PTokenImplementation", "Deploy PToken contract", require("./PTokenImplementation.deploy")).addOptionalParam(
  "errorsLibrary",
  "The address of errorsLibrary contract",
);
