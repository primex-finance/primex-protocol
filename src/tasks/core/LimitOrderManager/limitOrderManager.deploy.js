// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    registry,
    primexDNS,
    positionManager,
    whiteBlackList,
    traderBalanceVault,
    swapManager,
    primexPricingLibrary,
    tokenTransfersLibrary,
    limitOrderLibrary,
    errorsLibrary,
  },
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContract,
      getContractAt,
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  const { deployer } = await getNamedAccounts();
  if (!primexDNS) {
    primexDNS = (await getContract("PrimexDNS")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const limitOrderManager = await deploy("LimitOrderManager", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, primexDNS, positionManager, traderBalanceVault, swapManager, whiteBlackList],
        },
      },
    },
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      LimitOrderLibrary: limitOrderLibrary,
      Errors: errorsLibrary,
    },
  });

  if (limitOrderManager.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(limitOrderManager.address);
    await tx.wait();
    const LOM_ROLE = keccak256(toUtf8Bytes("LOM_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(LOM_ROLE, limitOrderManager.address);
    await txGrantRole.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const txGrantRole2 = await registryContract.grantRole(VAULT_ACCESS_ROLE, limitOrderManager.address);
    await txGrantRole2.wait();

    const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
    const txGrantRole3 = await registryContract.grantRole(NO_FEE_ROLE, limitOrderManager.address);
    await txGrantRole3.wait();
  }

  return limitOrderManager;
};
