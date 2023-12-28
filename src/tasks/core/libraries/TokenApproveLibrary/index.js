// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:TokenApproveLibrary", "Deploy TokenTransfersLibrary", require("./TokenApproveLibrary.deploy"));
