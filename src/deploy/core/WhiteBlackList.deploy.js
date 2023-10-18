// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  await run("deploy:WhiteBlackList", { registry: registry.address });
};
module.exports.tags = ["WhiteBlackList", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "PrimexProxyAdmin"];
