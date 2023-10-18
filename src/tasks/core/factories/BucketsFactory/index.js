// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:BucketsFactory", "Deploy BucketsFactory contract", require("./BucketsFactory.deploy"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("primexProxyAdmin", "The address of the PrimexProxyAdmin")
  .addOptionalParam("debtTokensFactory", "The address of debtTokensFactory contract")
  .addOptionalParam("pTokensFactory", "The address of pTokensFactory contract")
  .addOptionalParam("bucketImplementation", "The address of Bucket contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task("deploy:BucketImplementation", "Deploy Bucket contract", require("./BucketImplementation.deploy"))
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addParam("tokenTransfersLibrary", "The address of the TokenTransfersLibrary");
