// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:UniswapV2", "deploy uniswap v2 factory, router ", require("./UniswapV2.deploy")).addParam("name", "dex name");
