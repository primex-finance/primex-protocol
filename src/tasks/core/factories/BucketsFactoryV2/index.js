// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:BucketsFactoryV2", "Deploy BucketsFactoryV2 contract", require("./BucketsFactoryV2.deploy"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("primexProxyAdmin", "The address of the PrimexProxyAdmin")
  .addOptionalParam("debtTokensFactory", "The address of debtTokensFactory contract")
  .addOptionalParam("pTokensFactory", "The address of pTokensFactory contract")
  .addOptionalParam("bucketImplementation", "The address of Bucket contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
