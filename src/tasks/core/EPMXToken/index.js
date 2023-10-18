// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:EPMXToken", "Deploy EPMXToken contract", require("./EPMXToken.deploy"))
  .addParam("recipient", "Account to mint the initial supply to")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task("EPMXToken:addPrimexAddressesToWhitelist", "Add primex addresses to EPMX whitelist", require("./AddPrimexAddressesToWhitelist"));
