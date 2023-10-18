// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, treasury, periodDuration, priceOracle, primexPricingLibrary, errorsLibrary, pmx, traderBalanceVault },
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

  if (!primexPricingLibrary) {
    primexPricingLibrary = (await getContract("PrimexPricingLibrary")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }

  if (!traderBalanceVault) {
    traderBalanceVault = (await getContract("TraderBalanceVault")).address;
  }
  if (!treasury) {
    treasury = (await getContract("Treasury")).address;
  }
  const spotTradingRewardDistributor = await deploy(
    process.env.NEWPMX ? "SpotTradingRewardDistributorNewPmx" : "SpotTradingRewardDistributor",
    {
      contract: "SpotTradingRewardDistributor",
      from: deployer,
      log: true,
      proxy: {
        owner: (await getContract("PrimexProxyAdmin")).address,
        viaAdminContract: "PrimexProxyAdmin",
        proxyContract: "OpenZeppelinTransparentProxy",
        execute: {
          init: {
            methodName: "initialize",
            args: [registry, periodDuration, priceOracle, pmx, traderBalanceVault, treasury],
          },
        },
      },
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary,
        Errors: errorsLibrary,
      },
    },
  );
  if (spotTradingRewardDistributor.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const tx = await whiteBlackList.addAddressToWhitelist(spotTradingRewardDistributor.address);
    await tx.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(VAULT_ACCESS_ROLE, spotTradingRewardDistributor.address);
    await txGrantRole.wait();
  }
  return spotTradingRewardDistributor;
};
