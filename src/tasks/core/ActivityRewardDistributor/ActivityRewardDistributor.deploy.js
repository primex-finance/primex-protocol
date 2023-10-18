// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, treasury, primexDNS, errorsLibrary, pmx, traderBalanceVault, whiteBlackList },
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
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!treasury) {
    treasury = (await getContract("Treasury")).address;
  }

  if (!primexDNS) {
    primexDNS = (await getContract("PrimexDNS")).address;
  }

  if (!traderBalanceVault) {
    traderBalanceVault = (await getContract("TraderBalanceVault")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  if (!whiteBlackList) {
    whiteBlackList = (await getContract("WhiteBlackList")).address;
  }

  const activityRewardDistributor = await deploy(process.env.NEWPMX ? "ActivityRewardDistributorNewPmx" : "ActivityRewardDistributor", {
    contract: "ActivityRewardDistributor",
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",

      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [pmx, primexDNS, registry, treasury, traderBalanceVault, whiteBlackList],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (activityRewardDistributor.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(activityRewardDistributor.address);
    await tx.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(VAULT_ACCESS_ROLE, activityRewardDistributor.address);
    await txGrantRole.wait();
  }
  return activityRewardDistributor;
};
