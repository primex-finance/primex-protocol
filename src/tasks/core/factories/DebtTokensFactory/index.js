// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:DebtTokensFactory", "Deploy DebtTokensFactory contract", require("./DebtTokensFactory.deploy"))
  .addOptionalParam("debtTokenImplementation", "The address of DebtToken contract")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("primexProxyAdmin", "The address of the PrimexProxyAdmin")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task("deploy:DebtTokenImplementation", "Deploy DebtToken contract", require("./DebtTokenImplementation.deploy")).addOptionalParam(
  "errorsLibrary",
  "The address of errorsLibrary contract",
);
