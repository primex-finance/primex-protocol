// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:GasPriceOracleOptimism", "Deploy GasPriceOracleArbitrumOne contract", require("./GasPriceOracleOptimism.deploy.js"));
