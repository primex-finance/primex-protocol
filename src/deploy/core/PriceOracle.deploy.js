// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils");
const { NATIVE_CURRENCY } = require("../../test/utils/constants");

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  const errorsLibrary = await getContract("Errors");

  const { isETHNative, assets } = getConfig();
  const eth = isETHNative ? NATIVE_CURRENCY : assets.weth;

  await run("deploy:PriceOracle", { registry: registry.address, errorsLibrary: errorsLibrary.address, eth: eth });
};
module.exports.tags = ["PriceOracle", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "EPMXToken", "PrimexProxyAdmin", "Errors"];
