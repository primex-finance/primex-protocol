// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:MockOrally", "Deploy MockOrally contract", require("./MockOrally.deploy.js"));
