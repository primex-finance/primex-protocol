// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

const defaultValidTimePeriod = "60";
const defaultSingleUpdateFeeInWei = "1";

task("deploy:MockPyth", "Deploy MockPyth contract", require("./MockPyth.deploy.js"))
  .addParam(
    "validTimePeriod",
    "The period (in seconds) that a price feed is considered valid since its publish time",
    defaultValidTimePeriod,
  )
  .addParam("singleUpdateFeeInWei", "a fee in wei", defaultSingleUpdateFeeInWei);
