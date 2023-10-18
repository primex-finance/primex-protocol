const { task } = require("hardhat/config");

task("deploy:BalancerBotLens", "Deploy BalancerBotLens contract", require("./BalancerBotLens.deploy")).addOptionalParam(
  "errorsLibrary",
  "The address of errorsLibrary contract",
);
