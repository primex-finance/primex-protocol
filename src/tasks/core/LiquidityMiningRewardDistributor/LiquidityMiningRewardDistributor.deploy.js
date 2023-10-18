// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexDNS, pmx, traderBalanceVault, whiteBlackList, errorsLibrary, treasury, registry, reinvestmentRate, reinvestmentDuration },
  {
    deployments: { deploy },
    getNamedAccounts,
    ethers: {
      getContract,
      getContractAt,
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  if (!primexDNS) {
    primexDNS = (await getContract("PrimexDNS")).address;
  }
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }

  if (!whiteBlackList) {
    whiteBlackList = (await getContract("WhiteBlackList")).address;
  }

  if (!traderBalanceVault) {
    traderBalanceVault = (await getContract("TraderBalanceVault")).address;
  }

  if (!treasury) {
    treasury = (await getContract("Treasury")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const { deployer } = await getNamedAccounts();
  const liquidityMiningRewardDistributor = await deploy(
    process.env.NEWPMX ? "LiquidityMiningRewardDistributorNewPmx" : "LiquidityMiningRewardDistributor",
    {
      contract: "LiquidityMiningRewardDistributor",
      from: deployer,
      log: true,
      proxy: {
        owner: (await getContract("PrimexProxyAdmin")).address,
        viaAdminContract: "PrimexProxyAdmin",
        proxyContract: "OpenZeppelinTransparentProxy",
        execute: {
          init: {
            methodName: "initialize",
            args: [primexDNS, pmx, traderBalanceVault, registry, treasury, reinvestmentRate, reinvestmentDuration, whiteBlackList],
          },
        },
      },
      libraries: {
        Errors: errorsLibrary,
      },
    },
  );
  if (liquidityMiningRewardDistributor.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(liquidityMiningRewardDistributor.address);
    await tx.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(VAULT_ACCESS_ROLE, liquidityMiningRewardDistributor.address);
    await txGrantRole.wait();
  }
  return liquidityMiningRewardDistributor;
};
