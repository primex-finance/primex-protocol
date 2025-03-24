// SPDX-License-Identifier: BUSL-1.1

module.exports = async function (
  {
    registry,
    primexDNS,
    priceOracle,
    whiteBlackList,
    primexPricingLibrary,
    tokenTransfersLibrary,
    errorsLibrary,
    tierManager,
    magicTierCoefficient,
  },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const { deployer } = await getNamedAccounts();

  const depositManager = await deploy("DepositManager", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, primexDNS, priceOracle, whiteBlackList],
        },
      },
    },
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });

  if (depositManager.newlyDeployed) {
    let tx;
    const DepositManager = await getContractAt("DepositManager", depositManager.address);
    if (tierManager) {
      tx = await DepositManager.setTiersManager(tierManager);
      await tx.wait();
    }
    if (magicTierCoefficient) {
      tx = await DepositManager.setMagicTierCoefficient(magicTierCoefficient);
      await tx.wait();
    }
  }

  return depositManager;
};
