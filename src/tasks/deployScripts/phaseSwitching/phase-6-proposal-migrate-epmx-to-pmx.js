// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.NEWPMX = true;
  // deploy new reward contracts with PMX token instead of ePMX
  await run("phaseSwitch:deployRewardDistributors");
  await run("phaseSwitch:migrateEpmxToPmx");
  await run("phaseSwitch:updateRewardConfigurationsInBuckets");
  await run("phaseSwitch:updateRewardDistributors");
  console.log("=== finished ===");
};
