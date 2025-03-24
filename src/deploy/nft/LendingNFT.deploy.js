// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");
  await run("deploy:PrimexNFT", {
    deploymentName: "LendingPrimexNFT",
    registry: registry.address,
    name: "Lending Primex NFT",
    symbol: "LPMX",
    baseURI: "primex/",
  });
};

module.exports.tags = ["LendingPrimexNFT", "Test"];
module.exports.dependencies = ["Registry", "PrimexProxyAdmin"];
