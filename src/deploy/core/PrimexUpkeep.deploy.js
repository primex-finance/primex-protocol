// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const PositionManager = await getContract("PositionManager");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const PrimexLens = await getContract("PrimexLens");
  const Registry = await getContract("Registry");
  const BestDexLens = await getContract("BestDexLens");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PrimexUpkeep", {
    positionManager: PositionManager.address,
    bestDexLens: BestDexLens.address,
    limitOrderManager: LimitOrderManager.address,
    primexLens: PrimexLens.address,
    registry: Registry.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["PrimexUpkeep", "Test", "PrimexCore"];
module.exports.dependencies = ["PositionManager", "LimitOrderManager", "Registry", "BestDexLens", "PrimexLens", "WhiteBlackList", "Errors"];
