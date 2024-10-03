// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:BucketExtension", "Deploy BucketExtension contract", require("./BucketExtension.deploy"))
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("tokenTransfersLibrary", "The address of the TokenTransfersLibrary")
  .addParam("tokenApproveLibrary", "The address of the TokenApproveLibrary");
