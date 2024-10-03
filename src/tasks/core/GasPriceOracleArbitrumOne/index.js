// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:GasPriceOracleArbitrumOne", "Deploy GasPriceOracleArbitrumOne contract", require("./GasPriceOracleArbitrumOne.deploy"));
