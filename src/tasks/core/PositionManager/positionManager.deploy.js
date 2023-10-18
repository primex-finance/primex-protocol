// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  args,
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
  if (!args.primexDNS) {
    args.primexDNS = (await getContract("PrimexDNS")).address;
  }
  if (!args.errorsLibrary) {
    args.errorsLibrary = (await getContract("Errors")).address;
  }

  const positionManager = await deploy("PositionManager", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [
            args.registry,
            args.primexDNS,
            args.traderBalanceVault,
            args.priceOracle,
            args.keeperRewardDistributor,
            args.whiteBlackList,
          ],
        },
      },
    },
    libraries: {
      PrimexPricingLibrary: args.primexPricingLibrary,
      PositionLibrary: args.positionLibrary,
      TokenTransfersLibrary: args.tokenTransfersLibrary,
      Errors: args.errorsLibrary,
    },
  });

  if (positionManager.newlyDeployed) {
    let tx;
    const pmContract = await getContractAt("PositionManager", positionManager.address);
    if (!process.env.TEST) {
      const tx = await pmContract.setMinPositionSize(args.minPositionSize, args.minPositionAsset);
      await tx.wait();
    }

    tx = await pmContract.setDefaultOracleTolerableLimit(args.defaultOracleTolerableLimit);
    await tx.wait();
    tx = await pmContract.setOracleTolerableLimitMultiplier(args.oracleTolerableLimitMultiplier);
    await tx.wait();
    tx = await pmContract.setMaintenanceBuffer(args.maintenanceBuffer);
    await tx.wait();
    tx = await pmContract.setSecurityBuffer(args.securityBuffer);
    await tx.wait();

    args.whiteBlackList = await getContractAt("WhiteBlackList", args.whiteBlackList);
    tx = await args.whiteBlackList.addAddressToWhitelist(positionManager.address);
    await tx.wait();

    const PM_ROLE = keccak256(toUtf8Bytes("PM_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", args.registry);
    tx = await registryContract.grantRole(PM_ROLE, positionManager.address);
    await tx.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    tx = await registryContract.grantRole(VAULT_ACCESS_ROLE, positionManager.address);
    await tx.wait();
  }

  return positionManager;
};
