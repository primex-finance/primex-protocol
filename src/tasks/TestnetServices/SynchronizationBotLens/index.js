const { task } = require("hardhat/config");

task("deploy:SynchronizationBotLens", "Deploy SynchronizationBotLens contract", require("./SynchronizationBotLens.deploy"));
