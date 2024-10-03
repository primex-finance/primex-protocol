// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:ParaswapMock", "Deploy ParaswapMock contract ", require("./Paraswap.deploy"));
