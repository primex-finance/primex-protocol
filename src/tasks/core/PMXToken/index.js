// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PMXToken", "Deploy PMXToken contract", require("./PMXToken.deploy")).addParam(
  "recipient",
  "Account to mint the initial supply to",
);
