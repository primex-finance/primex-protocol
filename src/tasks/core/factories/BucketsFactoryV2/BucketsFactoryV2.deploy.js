// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, primexProxyAdmin, debtTokensFactory, pTokensFactory, bucketImplementation, errorsLibrary },
  { ethers: { getContract, getContractAt }, getNamedAccounts, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();

  if (!primexProxyAdmin) {
    primexProxyAdmin = (await getContract("PrimexProxyAdmin")).address;
  }

  if (!debtTokensFactory) {
    debtTokensFactory = (await getContract("DebtTokensFactory")).address;
  }

  if (!pTokensFactory) {
    pTokensFactory = (await getContract("PTokensFactory")).address;
  }

  if (!bucketImplementation) {
    bucketImplementation = (await getContract("Bucket")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const bucketsFactoryV2Address = await deploy("BucketsFactoryV2", {
    from: deployer,
    args: [registry, pTokensFactory, debtTokensFactory, bucketImplementation],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });

  if (bucketsFactoryV2Address.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const txAddAddressToWhitelist = await whiteBlackList.addAddressToWhitelist(bucketsFactoryV2Address.address);
    await txAddAddressToWhitelist.wait();

    const pTokensFactoryContract = await getContractAt("PTokensFactory", pTokensFactory);
    const txSetBucketsFactoryForPTokens = await pTokensFactoryContract.setBucketsFactory(bucketsFactoryV2Address.address);
    await txSetBucketsFactoryForPTokens.wait();

    const debtTokensFactoryContract = await getContractAt("DebtTokensFactory", debtTokensFactory);
    const txSetBucketsFactoryForDebtTokens = await debtTokensFactoryContract.setBucketsFactory(bucketsFactoryV2Address.address);
    await txSetBucketsFactoryForDebtTokens.wait();
    const bucketsFactoryV2 = await getContractAt("BucketsFactoryV2", bucketsFactoryV2Address.address);
    const txTransferOwnership = await bucketsFactoryV2.transferOwnership(primexProxyAdmin);
    await txTransferOwnership.wait();
  }

  return bucketsFactoryV2Address;
};
