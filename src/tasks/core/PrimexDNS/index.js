// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PrimexDNS", "Deploy PrimexDNS contract", require("./PrimexDNS.deploy"))
  .addParam("registry", "The address of registry contract")
  .addParam("pmx", "The address of the PMXToken contract")
  .addParam("treasury", "The address of the Primex Treasury contract")
  .addParam("delistingDelay", "The delay after which a deprecated bucket becomes delisted. Specified in seconds")
  .addParam(
    "adminWithdrawalDelay",
    "The delay after which admin can withdraw all funds from the bucket to Treasury and can close all limit orders of the bucket with the assignment of deposits",
  )
  .addParam("rates", "rates")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task("PrimexDNS:addDEX", "addDex in PrimexDNS contract", require("./PrimexDNS.addDEX"))
  .addParam("name", "new DEX domain name")
  .addParam("routerAddress", " exchange router address")
  .addParam("primexDNS", "The address of the PrimexDNS contract");

task("PrimexDNS:setAavePoolAddress", "Set Aave pool address in PrimexDNS", require("./setAavePoolAddress"));
