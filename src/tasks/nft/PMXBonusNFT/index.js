// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PMXBonusNFT", "Deploy PMXBonusNFT contract", require("./PMXBonusNFT.deploy"))
  .addOptionalParam("primexDNS", "The address of the PrimexDNS contract")
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("whiteBlackList", "The address of the WhiteBlackList contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
