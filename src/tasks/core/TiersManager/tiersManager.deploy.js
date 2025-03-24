// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { earlyPmx, registry, traderBalanceVault, lendingNFT, tradingNFT, farmingNFT, tiers, thresholds, notExecuteNewDeployedTasks },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  tiers = JSON.parse(tiers);
  thresholds = JSON.parse(thresholds);

  const { deployer } = await getNamedAccounts();

  const TiersManager = await deploy("TiersManager", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        methodName: "initialize",
        args: [earlyPmx, registry, lendingNFT, tradingNFT, farmingNFT, tiers, thresholds],
      },
    },
  });

  if (TiersManager.newlyDeployed && !notExecuteNewDeployedTasks) {
    const TiersManagerContract = await getContractAt("TiersManager", TiersManager.address);
    const initializeTx = await TiersManagerContract.initializeAfterUpgrade(traderBalanceVault);
    await initializeTx.wait();
  }
  return TiersManager;
};
