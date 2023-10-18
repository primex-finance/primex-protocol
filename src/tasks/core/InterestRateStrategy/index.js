// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:InterestRateStrategy", "Deploy InterestRateStrategy contract", require("./InterestRateStrategy.deploy")).addOptionalParam(
  "errorsLibrary",
  "The address of errorsLibrary contract",
);
