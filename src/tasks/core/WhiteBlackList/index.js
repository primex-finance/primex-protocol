// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:WhiteBlackList", "Deploy WhiteBlackList contract", require("./whiteBlackList.deploy"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
