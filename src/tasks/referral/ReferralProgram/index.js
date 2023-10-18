// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:ReferralProgram", "Deploy ReferralProgram contract", require("./referralProgram.deploy"))
  .addParam("registry", "The address of registry contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");

task("saveReferralsToFile", "Save current referrers and referrals to file", require("./dataMigration/saveReferralsToFile"));
task("updateReferralsFromFile", "Update referrers and referrals from file", require("./dataMigration/updateReferralsFromFile"));
