// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:MockStork", "Deploy MockStork contract", require("./MockStork.deploy.js"));
