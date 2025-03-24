// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const registry = await getContract("Registry");

  await run("deploy:PrimexNFT", {
    deploymentName: "TradingPrimexNFT",
    registry: registry.address,
    name: "Trading Primex NFT",
    symbol: "TPMX",
    baseURI: "primex/",
  });
};

module.exports.tags = ["TradingPrimexNFT", "Test"];
module.exports.dependencies = ["Registry", "PrimexProxyAdmin"];
