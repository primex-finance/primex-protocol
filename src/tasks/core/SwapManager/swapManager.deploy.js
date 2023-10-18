// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    registry,
    primexDNS,
    contractName,
    traderBalanceVault,
    priceOracle,
    whiteBlackList,
    primexPricingLibrary,
    tokenTransfersLibrary,
    errorsLibrary,
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

  const swapManager = await deploy(contractName ?? "SwapManager", {
    from: deployer,
    args: [registry, primexDNS, traderBalanceVault, priceOracle, whiteBlackList],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });

  if (swapManager.newlyDeployed) {
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
