// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:DexAdapter", "Deploy DexAdapter contract", require("./dexAdapter.deploy"))
  .addOptionalParam("registry", "The address of registry contract")
  .addOptionalParam("primexDNS", "The address of registry contract")
  .addParam("routers", "The list of address of Dex routers")
  .addParam("name", "The list of domain name DEXes")
  .addParam("dexTypes", "Types of DEXes")
  .addOptionalParam(
    "quoters",
    "The list of addresses of quoters. Quoters allow getting the expected amount out or amount in for a given swap without executing the swap",
  )
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("contractName", "The name of the contract artifact e.g DexAdapter")
  .addFlag("addDexesToDns", "");

task("DexAdapter:setDexType", "Set dex type in dex adapter", require("./dexAdapter.setDexType.js"))
  .addParam("router", "Dex router address for adding")
  .addParam("dexType", "Type of new dex")
  .addParam("dexAdapter", "DexAdapter contract address");
