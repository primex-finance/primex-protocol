// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { positionManager, bestDexLens, limitOrderManager, primexLens, registry, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const primexUpkeep = await deploy("PrimexUpkeep", {
    from: deployer,
    args: [positionManager, limitOrderManager, registry, bestDexLens, primexLens],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (primexUpkeep.newlyDeployed) {
    const whiteBlackList = await getContract("WhiteBlackList");
    const tx = await whiteBlackList.addAddressToWhitelist(primexUpkeep.address);
    await tx.wait();
  }
  return primexUpkeep;
};
