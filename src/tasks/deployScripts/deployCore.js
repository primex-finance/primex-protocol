// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");

module.exports = async function ({ noCompile }, { run }) {
  const { deployRefferalProgram } = getConfigByName("generalConfig.json");
  const tags = deployRefferalProgram ? "PrimexCore,ReferralProgram" : "PrimexCore";
  await run("deploy", { tags: tags, noCompile: noCompile });
  await run("EPMXToken:addPrimexAddressesToWhitelist");
  await run("setup:pairsConfig");
  await run("priceOracle:updateFeedsFromConfig");
  await run("setup:Buckets");
  await run("depositManager.setRewardParameters");

  await run("treasury:setTreasurySpendersByConfig");
  await run("reserve:setTransferRestrictionsByConfig");

  await run("PrimexDNS:setAavePoolAddress");
  await run("setup:setRolesForContractsOnly");

  console.log("=== protocol core deployed ===");
};
