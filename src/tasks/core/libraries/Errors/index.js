// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Errors", "Deploy Errors Library", require("./Errors.deploy"));
