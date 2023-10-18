// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:Registry", "Deploy Registry contract", require("./registry.deploy")).addOptionalParam(
  "errorsLibrary",
  "The address of errorsLibrary contract",
);
