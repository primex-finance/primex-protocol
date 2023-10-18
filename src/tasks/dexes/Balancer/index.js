// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Balancer", "Deploy Balancer contracts", require("./Balancer.deploy"));

task("balancer:createPool", "create balancer pool for tokens", require("./CreateWeightedPool"))
  .addParam("factory", "The address of the balancer factory")
  .addParam("from", "The name of tx sender", "deployer")
  .addOptionalParam("assets", "Array of assets containing addresses, amounts and weights of tokens")
  .addOptionalParam("fee", "Swap fee value");

task("balancer:addLiquidity", "Adds liquidity to an ERC-20⇄ERC-20 weighted pool", require("./addLiquidity"))
  .addParam("pool", "The address of the pool contract")
  .addParam("vault", "The address of the balancer vault")
  .addParam("from", "The name of tx sender", "deployer")
  .addParam("assets", "Array of assets containing addresses and amounts of tokens")
  .addParam("to", "Recipient of the output tokens", "deployer");
