// SPDX-License-Identifier: BUSL-1.1

// yarn hardhat node --no-deploy
// yarn hardhat deployFull:devnode1 --network localhost
//  yarn hardhat positionToCloseBySL --network localhost

// testTokenA = USDC
// testTokenB = WBTC

module.exports = async function (
  { depositAsset, positionAsset, depositAmount, borrowedAmount },
  {
    ethers: {
      getContract,
      constants: { MaxUint256, Zero },
    },
  },
) {
  const { getSingleRoute } = require("../../test/utils/dexOperations");
  const { getTakeProfitStopLossParams, getCondition } = require("../../test/utils/conditionParams");
  const { taskSetup, getTraderPositions } = require("./taskSetup");

  const dex = "uniswap";

  const setup = await taskSetup({ depositAsset, positionAsset, depositAmount, borrowedAmount });
  const positionManager = await getContract("PositionManager");
  const assetRoutes = await getSingleRoute([setup.borrowedTokenAddress, setup.positionTokenAddress], dex);
  const isThirdAsset = setup.depositTokenAddress !== setup.borrowedTokenAddress && setup.depositTokenAddress !== setup.positionTokenAddress;
  const stopLossPrice = MaxUint256;
  const deadline = Math.floor(new Date().getTime() / 1000) + 600;
  console.log("Opening position...");
  const tx = await positionManager.openPosition({
    marginParams: {
      bucket: setup.borrowedAmount.gt(Zero) ? "Primex Bucket USDC" : "",
      borrowedAmount: setup.borrowedAmount,
      depositToBorrowedRoutes: [],
      depositInThirdAssetRoutes: isThirdAsset ? await getSingleRoute([setup.depositTokenAddress, setup.positionTokenAddress], dex) : [],
    },
    firstAssetRoutes: assetRoutes,
    depositAsset: setup.depositTokenAddress,
    depositAmount: setup.depositAmount,
    positionAsset: setup.positionTokenAddress,
    amountOutMin: "0",
    deadline: deadline,
    makeDeposit: false,
    closeConditions: [getCondition("2", getTakeProfitStopLossParams(0, stopLossPrice))],
  });
  await tx.wait();

  const positionId = await getTraderPositions();
  console.log(`Position is opened, id = ${positionId.toString()}`);

  const primexLens = await getContract("PrimexLens");
  const stopLossReached = await primexLens.isStopLossReached(positionManager.address, positionId);
  console.log("stopLossReached = ", stopLossReached);

  // for test proposals, because position can be risky and with SL
  const isPositionRisky = await positionManager.isPositionRisky(positionId);
  console.log("isPositionRisky = ", isPositionRisky);

  console.log("-----------------");
};
