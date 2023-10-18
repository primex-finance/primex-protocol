// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const earlyPmx = await getContract("EPMXToken");
  const pmx = await getContract("PMXToken");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const registry = await getContract("Registry");

  await run("deploy:Redeemer", {
    earlyPmx: earlyPmx.address,
    pmx: pmx.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    registry: registry.address,
  });
};

module.exports.tags = ["Redeemer", "Test"];
module.exports.dependencies = ["EPMXToken", "PMXToken", "TokenTransfersLibrary", "Registry"];
