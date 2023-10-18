// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:InterestIncreaser", "Deploy InterestIncreaser contract", require("./InterestIncreaser.deploy"))
  .addParam("whiteBlackList", "An address of WhiteBlackList to be used")
  .addOptionalParam("bonusNft", "An address of NFT to be used")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("primexDNS", "The address of PrimexDNS contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
