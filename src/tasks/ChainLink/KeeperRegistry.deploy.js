// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run, getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  const LinkToken = await deploy("LinkToken", {
    from: deployer,
    log: true,
  });

  const linkEthFeed = await run("deploy:PrimexAggregatorV3TestService", { name: "linkEthFeed" });
  const fastGasFeed = await run("deploy:PrimexAggregatorV3TestService", { name: "fastGasFeed" });

  // values is from config in mainnet
  const args = [
    LinkToken.address, // address link,
    linkEthFeed.address, // address linkEthFeed,
    fastGasFeed.address, // address fastGasFeed,
    "200000000", // uint32 paymentPremiumPPB,
    "10", // uint24 blockCountPerTurn,
    "6500000", // uint32 checkGasLimit,
    "90000", // uint24 stalenessSeconds,
    "2", // uint16 gasCeilingMultiplier,
    "200000000000", // uint256 fallbackGasPrice,
    "20000000000000000", // uint256 fallbackLinkPrice
  ];

  const KeeperRegistry = await deploy("KeeperRegistry", {
    from: deployer,
    args: args,
    log: true,
  });

  return [KeeperRegistry, LinkToken, linkEthFeed, fastGasFeed];
};
