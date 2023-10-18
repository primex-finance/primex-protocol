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

  const bucketsFactoryAddress = await deploy("BucketsFactory", {
    from: deployer,
    args: [registry, pTokensFactory, debtTokensFactory, bucketImplementation],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });

  if (bucketsFactoryAddress.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const txAddAddressToWhitelist = await whiteBlackList.addAddressToWhitelist(bucketsFactoryAddress.address);
    await txAddAddressToWhitelist.wait();

    const pTokensFactoryContract = await getContractAt("PTokensFactory", pTokensFactory);
    const txSetBucketsFactoryForPTokens = await pTokensFactoryContract.setBucketsFactory(bucketsFactoryAddress.address);
    await txSetBucketsFactoryForPTokens.wait();

    const debtTokensFactoryContract = await getContractAt("DebtTokensFactory", debtTokensFactory);
    const txSetBucketsFactoryForDebtTokens = await debtTokensFactoryContract.setBucketsFactory(bucketsFactoryAddress.address);
    await txSetBucketsFactoryForDebtTokens.wait();
    const bucketsFactory = await getContractAt("BucketsFactory", bucketsFactoryAddress.address);
    const txTransferOwnership = await bucketsFactory.transferOwnership(primexProxyAdmin);
    await txTransferOwnership.wait();
  }

  return bucketsFactoryAddress;
};
