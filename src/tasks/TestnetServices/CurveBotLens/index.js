const { task } = require("hardhat/config");

task("deploy:CurveBotLens", "Deploy CurveBotLens contract", require("./CurveBotLens.deploy"));
