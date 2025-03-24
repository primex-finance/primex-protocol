// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  await run("deploy:PrimexNFT", {
    deploymentName: "FarmingPrimexNFT",
    registry: registry.address,
    name: "Farming Primex NFT",
    symbol: "FPMX",
    baseURI: "primex/",
  });
};

module.exports.tags = ["FarmingPrimexNFT", "Test"];
module.exports.dependencies = ["Registry", "PrimexProxyAdmin"];
