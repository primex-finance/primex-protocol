// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { positionManager, contractName, priceOracle, primexPricingLibrary, positionLibrary, registry, whiteBlackList, errorsLibrary },
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

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const batchManager = await deploy(contractName ?? "BatchManager", {
    from: deployer,
    log: true,
    args: [positionManager, priceOracle, whiteBlackList, registry],
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      PositionLibrary: positionLibrary,
      Errors: errorsLibrary,
    },
  });

  if (batchManager.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(batchManager.address);
    await tx.wait();

    const BATCH_MANAGER_ROLE = keccak256(toUtf8Bytes("BATCH_MANAGER_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(BATCH_MANAGER_ROLE, batchManager.address);
    await txGrantRole.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const txGrantRole2 = await registryContract.grantRole(VAULT_ACCESS_ROLE, batchManager.address);
    await txGrantRole2.wait();
  }

  return batchManager;
};
