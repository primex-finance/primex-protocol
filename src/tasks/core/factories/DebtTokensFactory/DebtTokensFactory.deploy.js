// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { debtTokenImplementation, primexProxyAdmin, registry, errorsLibrary },
  { ethers: { getContract, getContractAt }, getNamedAccounts, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();

  if (!debtTokenImplementation) {
    debtTokenImplementation = (await getContract("DebtToken")).address;
  }

  if (!registry) {
    registry = (await getContract("Registry")).address;
  }

  if (!primexProxyAdmin) {
    primexProxyAdmin = (await getContract("PrimexProxyAdmin")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const DebtTokensFactory = await deploy("DebtTokensFactory", {
    from: deployer,
    args: [debtTokenImplementation, registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });

  if (DebtTokensFactory.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    let tx = await whiteBlackList.addAddressToWhitelist(DebtTokensFactory.address);
    await tx.wait();
    const debtTokensFactory = await getContractAt("DebtTokensFactory", DebtTokensFactory.address);
    tx = await debtTokensFactory.transferOwnership(primexProxyAdmin);
    await tx.wait();
  }
  return DebtTokensFactory;
};
