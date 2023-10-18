// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Aave", "Deploy aave v3", require("./Aave.deploy"));

task("Aave:addLiquidity", "Add liquidity in aave v3 pool", require("./addLiquidity"))
  .addParam("from", "The name of the tx sender")
  .addParam("to", "Recipient of the output tokens")
  .addParam("token", "Token address.")
  .addParam("amount", "The amount of token to add as liquidity");
