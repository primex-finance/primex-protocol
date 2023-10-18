// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { deploymentName, registry, minDelay, proposers, executors, admin, errorsLibrary },
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContract,
      constants: { AddressZero },
    },
  },
) {
  const { deployer } = await getNamedAccounts();
  if (registry === undefined) {
    registry = (await getContract("Registry")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  if (admin === undefined) {
    admin = AddressZero;
  }
  proposers = JSON.parse(proposers);
  executors = JSON.parse(executors);
  if (admin === AddressZero && (proposers.length === 0 || executors.length === 0))
    throw new Error("Set admin or proposers and executors. Otherwise, the contract will be without management");

  const primexTimelock = await deploy(deploymentName, {
    contract: "PrimexTimelock",
    from: deployer,
    args: [minDelay, proposers, executors, admin, registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (primexTimelock.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const tx = await whiteBlackList.addAddressToWhitelist(primexTimelock.address);
    await tx.wait();
  }
  return primexTimelock;
};
