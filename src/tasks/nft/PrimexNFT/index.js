// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexNFT", "Deploy PrimexNFT contract", require("./PrimexNFT.deploy.js"))
  .addParam("deploymentName", "Name of deployment artifact")
  .addOptionalParam("registry", "The address of registry contract")
  .addParam("name", "The name of the NFT token")
  .addParam("symbol", "The symbol of the NFT token")
  .addParam("baseURI", "a new baseURI")
  .addOptionalParam("implementationName", "");
