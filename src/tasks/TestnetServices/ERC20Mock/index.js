// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");
const ethers = require("ethers");

task("deploy:ERC20Mock", "Deploy ERC20Mock contract", require("./erc20Mock.deploy"))
  .addParam("name", "The ERC20 token name", "TestToken")
  .addParam("symbol", "The ERC20 token symbol", "TT")
  .addParam("decimals", "The ERC20 token decimals", "18")
  .addParam("initialAccounts", "The addresses of user who will get the initial tokens (default value is 'lender' address)", "[]")
  .addParam("initialBalances", "The amounts of tokens will be minted for 'initialAccounts' (default value is 12000 tokens)", "[]")
  .addParam(
    "mintingAmount",
    "The amounts of tokens user can mint when isTimeLimitedMinting=true every 24 hours",
    ethers.utils.parseEther("50").toString(),
  );
task("deploy:WETHMock", "Deploy ERC20Mock contract", require("./MockWETH.deploy"));

task("deploy:NonStandartERC20Mock", "Deploy non standart ERC20Mock contract", require("./NonStandartErc20Mock.deploy.js"))
  .addParam("name", "The ERC20 token name", "Tether")
  .addParam("symbol", "The ERC20 token symbol", "USDT")
  .addParam("decimals", "The ERC20 token decimals", "18")
  .addParam("initialSupply", "The amount of tokens will be minted for an owner account", ethers.utils.parseEther("100").toString());
