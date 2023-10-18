// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:KeeperRegistry", "Deploy KeeperRegistry ChainLink contract", require("./KeeperRegistry.deploy"));

task(
  "deploy:CounterUpKeep",
  "Deploy CounterUpKeep is an example of a contract that will be serviced using chainlink oracles",
  require("./CounterUpKeep.deploy"),
).addParam("interval", "the time interval in seconds after which the oracle chainlink updates the counter", "60");

task(
  "KeeperRegistry:setKeepers",
  "sets new keepers' addresses, deletes old keepers. The number of payees and keepers must be the same and at least two",
  require("./setKeepers"),
)
  .addParam("keeperRegistryAddress", "The address of KeeperRegistry")
  .addParam("payees", "The list of addresses keepers payees")
  .addParam("keepers", "The list of addresses keepers");

task("KeeperRegistry:registerUpkeepAndAddFunds", "sets new Upkeep.", require("./registerUpkeepAndAddFunds"))
  // registerUpkeep params
  .addParam("keeperRegistryAddress", "The address of KeeperRegistry")
  .addParam("linkTokenAddress", "The address of LinkToken(erc677)")
  .addParam("target", "address to perform upkeep on")
  .addParam("gasLimit", "amount of gas to provide the target contract when performing upkeep", "2500000")
  .addParam("admin", "address to cancel upkeep and withdraw remaining funds")
  .addParam("checkData", "data passed to the contract when checking for upkeep", "0x00")
  // addFunds params
  .addParam("amount", "amount LinkToken to addFunds");
