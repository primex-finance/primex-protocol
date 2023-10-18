// SPDX-License-Identifier: BUSL-1.1

const { setConfig } = require("../../../config/configUtils.js");

module.exports = async function ({ _ }) {
  await run("deploy", { tags: "market", noCompile: true }); // "market" is a tag for aave deploy scripts
  const { getPoolAddressesProvider } = require("@aave/deploy-v3");
  const addressesProvider = await getPoolAddressesProvider();
  const poolAddress = await addressesProvider.getPool();
  setConfig("aave", poolAddress);
};
