// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:MockFlashLoanReceiver", "Deploy MockPyth contract", require("./MockFlashLoanReceiver.deploy.js"));
