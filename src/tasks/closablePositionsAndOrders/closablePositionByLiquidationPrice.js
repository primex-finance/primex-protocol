// SPDX-License-Identifier: BUSL-1.1

// yarn hardhat node --no-deploy
// yarn hardhat deployFull:devnode1 --network localhost
// yarn hardhat positionToCloseByLiq --network localhost

// testTokenA = USDC
// testTokenB = WBTC

module.exports = async function (
  { depositAsset, positionAsset, depositAmount, borrowedAmount },
  {
    ethers: {
      getContract,
      getContractAt,
      constants: { Zero },
      BigNumber,
    },
  },
) {
  const { getSingleRoute } = require("../../test/utils/dexOperations");
  const { MAX_TOKEN_DECIMALITY } = require("../../test/utils/constants");
  const { wadMul } = require("../../test/utils/bnMath");
  const { taskSetup, getTraderPositions } = require("./taskSetup");

  const positionManager = await getContract("PositionManager");
  const PrimexLens = await getContract("PrimexLens");

  const setup = await taskSetup({ depositAsset, positionAsset, depositAmount, borrowedAmount });
  const dex = "uniswap";
  const assetRoutes = await getSingleRoute([setup.borrowedTokenAddress, setup.positionTokenAddress], dex);
  const isThirdAsset = setup.depositTokenAddress !== setup.borrowedTokenAddress && setup.depositTokenAddress !== setup.positionTokenAddress;
  const deadline = Math.floor(new Date().getTime() / 1000) + 600;
  if (setup.borrowedAmount.eq(Zero)) {
    throw new Error("Zero borrowed amount for the liquidated position");
  }
  console.log("Opening position...");
  const tx = await positionManager.openPosition({
    marginParams: {
      bucket: "Primex Bucket USDC",
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
    closeConditions: [],
  });
  await tx.wait();

  const positionId = await getTraderPositions();
  console.log(`Position is opened, id = ${positionId.toString()}`);

  // to equalize the price
  // await swapAtoB('wbtc', 'usdc');
  const priceOracle = await getContract("PriceOracle");

  const liqPrice = await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, positionId);
  const { basePriceFeed, quotePriceFeed } = await priceOracle.getPriceFeedsPair(setup.positionTokenAddress, setup.borrowedTokenAddress);
  const quotePriceFeedContract = await getContractAt("PrimexAggregatorV3TestService", quotePriceFeed);
  let quotePrice = (await quotePriceFeedContract.latestRoundData())[1];
  quotePrice = quotePrice.mul(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub("8")));

  const basePrice = wadMul(liqPrice.mul(setup.borrowedTokenMultiplier), quotePrice.toString()).toString();

  const priceFeedUpdaterTestService = await getContract("PriceFeedUpdaterTestService");
  await priceFeedUpdaterTestService.updatePriceFeed(
    basePriceFeed,
    BigNumber.from(basePrice).div(BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub("8"))),
  );

  const isPositionRisky = await positionManager.isPositionRisky(positionId);
  const liquidationPriceFinal = await PrimexLens["getLiquidationPrice(address,uint256)"](positionManager.address, positionId);
  console.log("isPositionRisky = ", isPositionRisky);
  console.log("Liquidation price: ", liquidationPriceFinal.toString());
  console.log("-----------------");
};
