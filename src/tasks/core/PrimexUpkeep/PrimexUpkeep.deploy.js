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
    args: [registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (primexUpkeep.newlyDeployed) {
    const PrimexUpkeep = await getContract("PrimexUpkeep");
    const initializeTx = await PrimexUpkeep.initialize(positionManager, limitOrderManager, bestDexLens, primexLens);
    await initializeTx.wait();
    const whiteBlackList = await getContract("WhiteBlackList");
    const tx = await whiteBlackList.addAddressToWhitelist(primexUpkeep.address);
    await tx.wait();
  }
  return primexUpkeep;
};
