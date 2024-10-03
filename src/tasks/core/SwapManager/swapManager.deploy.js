// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    registry,
    primexDNS,
    traderBalanceVault,
    priceOracle,
    whiteBlackList,
    primexPricingLibrary,
    tokenTransfersLibrary,
    errorsLibrary,
    notExecuteNewDeployedTasks,
  },
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContractAt,
      getContract,
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const { deployer } = await getNamedAccounts();

  const swapManager = await deploy("SwapManager", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        methodName: "initialize",
        args: [registry],
      },
    },
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });

  if (swapManager.newlyDeployed && !notExecuteNewDeployedTasks) {
    const SwapManagerContract = await getContractAt("SwapManager", swapManager.address);
    const initilizeTx = await SwapManagerContract.initializeAfterUpgrade(primexDNS, traderBalanceVault, priceOracle, whiteBlackList);
    await initilizeTx.wait();
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(swapManager.address);
    await tx.wait();
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(VAULT_ACCESS_ROLE, swapManager.address);
    await txGrantRole.wait();
  }

  return swapManager;
};
