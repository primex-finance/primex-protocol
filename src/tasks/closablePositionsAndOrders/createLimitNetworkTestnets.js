// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

module.exports = async function (
  {
    depositAsset = "link",
    positionAsset = "wbtc",
    depositAmount = "50",
    shouldOpenPosition = true,
    takeDepositFromWallet,
    payFeeFromWallet,
    leverage = "2",
    deadline,
    openPriceRate,
  },
  {
    ethers: {
      BigNumber,
      getContract,
      getContractAt,
      getNamedSigners,
      utils: { parseEther, parseUnits },
      constants: { MaxUint256, Zero },
    },
  },
) {
  const {
    getLimitPriceParams,
    getLimitPriceAdditionalParams,
    getTakeProfitStopLossParams,
    getCondition,
  } = require("../../test/utils/conditionParams");
  const { getDexWithAncillaryData } = require("./taskSetup.js");

  const YEAR = 3600 * 24 * 365;

  leverage = parseEther(leverage);

  const isNotSpot = leverage.gt(parseEther("1"));

  const { LIMIT_PRICE_CM_TYPE, TAKE_PROFIT_STOP_LOSS_CM_TYPE, MAX_TOKEN_DECIMALITY } = require("../../test/utils/constants");
  const { getConfig } = require("../../config/configUtils");
  const { assets } = getConfig();

  const { wadMul, wadDiv } = require("../../test/utils/bnMath");

  if (!assets[depositAsset] || !assets[positionAsset]) {
    throw new Error("Incorrect asset");
  }

  const positionToken = await getContractAt("ERC20", assets[positionAsset]);
  const depositToken = await getContractAt("ERC20", assets[depositAsset]);
  const borrowedToken = await getContractAt("ERC20", assets.usdc);

  const positionManager = await getContract("PositionManager");
  const limitOrderManager = await getContract("LimitOrderManager");
  const bestDexLens = await getContract("BestDexLens");
  const priceOracle = await getContract("PriceOracle");
  const bucketUSDC = await getContract("Primex Bucket USDC");

  const isThirdAsset = depositToken.address !== borrowedToken.address && depositToken.address !== positionToken.address;

  const maxLeverage = await bucketUSDC.maxAssetLeverage(positionToken.address);
  if (maxLeverage.lt(leverage)) {
    throw new Error(`Incorrect leverage. Max leverage is ${maxLeverage.toString()}`);
  }

  const { deployer } = await getNamedSigners();

  const dexWithAncillaryData = await getDexWithAncillaryData();

  let tx;

  tx = await depositToken.approve(limitOrderManager.address, MaxUint256);
  await tx.wait();

  const positionDecimals = await positionToken.decimals();
  const depositDecimals = await depositToken.decimals();
  const borrowedDecimals = await borrowedToken.decimals();

  depositAmount = parseUnits(depositAmount, depositDecimals);
  let depositInPositionAsset = Zero;
  let amountIn;
  let amountToTransfer;
  let depositAmountInBorrowed;
  let borrowedAmountInPositionAsset = Zero;
  let borrowedAmount;

  if (isThirdAsset) {
    const { returnAmount } = await bestDexLens.callStatic.getBestMultipleDexes({
      positionManager: positionManager.address,
      assetToBuy: positionToken.address,
      assetToSell: depositToken.address,
      amount: depositAmount,
      isAmountToBuy: false,
      shares: 1,
      gasPriceInCheckedAsset: 0,
      dexes: dexWithAncillaryData,
    });
    depositInPositionAsset = returnAmount;
  }

  if (depositToken.address === borrowedToken.address) {
    amountIn = wadMul(depositAmount, leverage);
    amountToTransfer = amountIn;
    borrowedAmount = amountIn.sub(depositAmount);
  } else {
    if (depositAsset === positionAsset) {
      depositInPositionAsset = depositAmount;
    }
    const primexPricingLibrary = await getContract("PrimexPricingLibrary");
    depositAmountInBorrowed = await primexPricingLibrary.getOracleAmountsOut(
      depositToken.address,
      borrowedToken.address,
      depositAmount,
      priceOracle.address,
    );
    amountIn = wadMul(depositAmountInBorrowed, leverage);
    amountToTransfer = amountIn.sub(depositAmountInBorrowed);
    borrowedAmount = amountToTransfer;
  }

  const { returnAmount } = await bestDexLens.callStatic.getBestMultipleDexes({
    positionManager: positionManager.address,
    assetToBuy: positionToken.address,
    assetToSell: borrowedToken.address,
    amount: amountToTransfer,
    isAmountToBuy: false,
    shares: 1,
    gasPriceInCheckedAsset: 0,
    dexes: dexWithAncillaryData,
  });
  borrowedAmountInPositionAsset = returnAmount;

  const multiplierA = parseUnits("1", BigNumber.from(MAX_TOKEN_DECIMALITY).sub(depositDecimals));
  const multiplierB = parseUnits("1", BigNumber.from(MAX_TOKEN_DECIMALITY).sub(positionDecimals));
  const multiplierC = parseUnits("1", BigNumber.from(MAX_TOKEN_DECIMALITY).sub(borrowedDecimals));

  const amountOut = depositInPositionAsset.add(borrowedAmountInPositionAsset);

  const currentPrice = wadDiv(amountIn.mul(multiplierC), amountOut.mul(multiplierB)).div(multiplierC);

  if (isNotSpot) {
    if ((await borrowedToken.balanceOf(bucketUSDC.address)).lt(borrowedAmount)) {
      tx = await borrowedToken.approve(bucketUSDC.address, borrowedAmount);
      await tx.wait();
      tx = await bucketUSDC.deposit(deployer.address, borrowedAmount, 0, true);
      await tx.wait();
    }
  }

  tx = await limitOrderManager.createLimitOrder(
    {
      bucket: isNotSpot ? "Primex Bucket USDC" : "",
      depositAmount: depositAmount,
      depositAsset: depositToken.address,
      positionAsset: positionToken.address,
      deadline: Math.floor(new Date().getTime() / 1000) + (Number(deadline) ?? YEAR),
      takeDepositFromWallet: takeDepositFromWallet,
      payFeeFromWallet: payFeeFromWallet,
      leverage: leverage,
      shouldOpenPosition: shouldOpenPosition,
      openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(wadMul(currentPrice, parseEther(openPriceRate).toString())))],
      closeConditions: [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, currentPrice.mul(2).mul(multiplierA).sub(1))),
      ],
    },
    { value: parseEther("0.4") },
  );
  const txReceipt = await tx.wait();
  const orderId = txReceipt.events?.filter(x => {
    return x.event === "CreateLimitOrder";
  })[0].args.orderId;

  console.log(`order ${orderId} has been created`);

  const bestShares = await bestDexLens.callStatic.getBestDexByOrder([
    positionManager.address,
    limitOrderManager.address,
    orderId,
    { firstAssetShares: 1, depositInThirdAssetShares: 1, depositToBorrowedShares: 1 },
    dexWithAncillaryData,
  ]);

  console.log(`getBestDex ${orderId} order:`, bestShares.firstAssetReturnParams.routes[0].paths[0].dexName);

  const additionalParams = getLimitPriceAdditionalParams(
    bestShares.firstAssetReturnParams.routes,
    bestShares.depositInThirdAssetReturnParams.routes,
    bestShares.depositToBorrowedReturnParams.routes,
  );

  const params = {
    orderId: orderId,
    conditionIndex: 0,
    comAdditionalParams: additionalParams,
    firstAssetRoutes: bestShares.firstAssetReturnParams.routes,
    depositInThirdAssetRoutes: bestShares.depositInThirdAssetReturnParams.routes,
    keeper: deployer.address,
  };
  const canBeFilled = await limitOrderManager.callStatic.canBeFilled(params.orderId, params.conditionIndex, params.comAdditionalParams);
  expect(canBeFilled).to.equal(true);

  console.log(`Can ${orderId} order be executed:`, canBeFilled);

  await limitOrderManager.callStatic.openPositionByOrder(params);

  // check that the position opened by the order is canBeClosed
  // await limitOrderManager.openPositionByOrder(params);
  // console.log(await positionManager.callStatic.canBeClosed(0, 0, "0x"));
};
