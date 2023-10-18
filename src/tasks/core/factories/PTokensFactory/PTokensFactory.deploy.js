// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { ptokenImplementation, primexProxyAdmin, registry, errorsLibrary },
  { ethers: { getContract, getContractAt }, getNamedAccounts, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();
  if (!ptokenImplementation) {
    ptokenImplementation = (await getContract("PToken")).address;
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

  const PTokensFactory = await deploy("PTokensFactory", {
    from: deployer,
    args: [ptokenImplementation, registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (PTokensFactory.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    let tx = await whiteBlackList.addAddressToWhitelist(PTokensFactory.address);
    await tx.wait();
    const pTokensFactory = await getContractAt("PTokensFactory", PTokensFactory.address);
    tx = await pTokensFactory.transferOwnership(primexProxyAdmin);
    await tx.wait();
  }

  return PTokensFactory;
};
