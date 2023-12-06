// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    provider,
    getContract,
    getContractFactory,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { parseArguments } = require("../utils/eventValidation");

const { addLiquidity, getSingleRoute, getAmountsOut } = require("../utils/dexOperations");
const {
  calculateRewardPerToken,
  calculateRewardIndex,
  calculateFixedReward,
  calculateEndTimestamp,
  Role,
} = require("../utils/activityRewardDistributorMath");
const { wadMul, wadDiv } = require("../utils/math");
const { OrderType, NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

describe("TraderRewardDistributor_integration", function () {
  let pmx, bucket, activityRewardDistributor, debtToken, positionManager, dex, priceFeed;
  let deployer, user, trader, lender;
  let totalRewards, rewardPerDay;
  let expectBucketData, expectTraderInfo, expectUserInfo, OpenPositionParams, closeRoute;
  let testTokenA, testTokenB, decimalsA, decimalsB, multiplierA, multiplierB;
  let protocolRate, PriceInETH, amountOut, amountB;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, lender, trader, user } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    testTokenB = await getContract("TestTokenB");
    decimalsA = await testTokenA.decimals();
    decimalsB = await testTokenB.decimals();
    multiplierA = BigNumber.from(10).pow(BigNumber.from(18).sub(decimalsA));
    multiplierB = BigNumber.from(10).pow(BigNumber.from(18).sub(decimalsB));
    activityRewardDistributor = await getContract("ActivityRewardDistributor");
    positionManager = await getContract("PositionManager");

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    pmx = await getContract("EPMXToken");
    const PrimexDNS = await getContract("PrimexDNS");
    protocolRate = await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY);

    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("1000", decimalsA), true);

    debtToken = await getContractAt("DebtToken", await bucket.debtToken());
    await debtToken.setTraderRewardDistributor(activityRewardDistributor.address);

    // env setup
    dex = process.env.DEX ?? "uniswap";
    await addLiquidity({
      dex: dex,
      amountADesired: "100000",
      amountBDesired: "100000",
      from: "lender",
      tokenA: testTokenA,
      tokenB: testTokenB,
    });

    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals(decimalsA);
    await priceFeed.setAnswer(1);
    const priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);

    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    PriceInETH = parseEther("0.3"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(PriceInETH);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);
    await positionManager.setMaintenanceBuffer(parseEther("0.01"));

    closeRoute = await getSingleRoute([testTokenB.address, testTokenA.address], dex);
    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: 0,
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
      depositAsset: testTokenA.address,
      depositAmount: 0,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: MaxUint256,
      takeDepositFromWallet: true,
      payFeeFromWallet: true,
      closeConditions: [],
    };

    expectBucketData = {
      rewardIndex: BigNumber.from("0"),
      lastUpdatedTimestamp: 0,
      rewardPerToken: BigNumber.from("0"),
      scaledTotalSupply: BigNumber.from("0"),
      isFinished: false,
      fixedReward: 0,
      lastUpdatedRewardTimestamp: 0,
      rewardPerDay: 0,
      totalReward: 0,
      endTimestamp: 0,
    };
    expectTraderInfo = {
      fixedReward: BigNumber.from("0"),
      lastUpdatedRewardIndex: 0,
      oldBalance: BigNumber.from("0"),
    };

    expectUserInfo = {
      fixedReward: BigNumber.from("0"),
      lastUpdatedRewardIndex: 0,
      oldBalance: BigNumber.from("0"),
    };
    totalRewards = parseEther("10000");
    rewardPerDay = parseEther("1000");
  });

  it("Step 0. Should setup trader reward distributor", async function () {
    await pmx.approve(activityRewardDistributor.address, totalRewards);

    const nextTimestamp = (await provider.getBlock("latest")).timestamp + 2 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

    await expect(() =>
      activityRewardDistributor.setupBucket(bucket.address, Role.TRADER, totalRewards, rewardPerDay),
    ).to.changeTokenBalances(pmx, [activityRewardDistributor, deployer], [totalRewards, totalRewards.mul(NegativeOne)]);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp;
    expectBucketData.lastUpdatedRewardTimestamp = nextTimestamp;
    expectBucketData.totalReward = totalRewards;
    expectBucketData.rewardPerDay = rewardPerDay;
    expectBucketData.endTimestamp = calculateEndTimestamp(nextTimestamp, totalRewards, rewardPerDay);

    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData);
  });

  it("Step 1. Should update users activities after increase and decrease debt(open and close position)", async function () {
    const traderBorrowedAmount = parseUnits("50", decimalsA);
    const traderBorrowedAmount2 = traderBorrowedAmount.mul(2);
    const userBorrowedAmount = traderBorrowedAmount.mul(2);

    const depositAmount = traderBorrowedAmount;
    OpenPositionParams.depositAmount = depositAmount;
    let feeAmountCalculateWithETHRate;
    let feeAmountInEth;

    await testTokenA.mint(user.address, traderBorrowedAmount.mul(10));
    await testTokenA.connect(user).approve(positionManager.address, MaxUint256);

    await testTokenA.mint(trader.address, traderBorrowedAmount.mul(10));
    await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);

    const swapSize = depositAmount.add(traderBorrowedAmount);
    const swap = swapSize.mul(multiplierA);
    amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    amountB = amountOut.mul(multiplierB);
    const price0 = wadDiv(swap.toString(), amountB.toString()).toString();
    const limitPrice0 = BigNumber.from(price0).div(multiplierA);
    await priceFeed.setAnswer(limitPrice0);

    // trader openPosition
    const unusedTime = 2 * 24 * 60 * 60;
    const nextTimestamp1 = expectBucketData.lastUpdatedTimestamp + unusedTime;
    expectBucketData.endTimestamp = expectBucketData.endTimestamp.add(unusedTime);
    expectBucketData.lastUpdatedRewardTimestamp += unusedTime;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);

    OpenPositionParams.marginParams.borrowedAmount = traderBorrowedAmount;
    feeAmountCalculateWithETHRate = BigNumber.from(
      wadMul(traderBorrowedAmount.add(depositAmount).toString(), protocolRate.toString()).toString(),
    );
    feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.mul(multiplierA).toString(), PriceInETH.toString()).toString();

    await positionManager.connect(trader).openPosition(OpenPositionParams, { value: feeAmountInEth });

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp1, expectBucketData);
    expectBucketData.scaledTotalSupply = await debtToken.scaledTotalSupply();
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, expectBucketData.scaledTotalSupply);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp1;
    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData);

    expectTraderInfo.oldBalance = await debtToken.scaledBalanceOf(trader.address);
    expectTraderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const traderInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
    parseArguments(expectTraderInfo, traderInfo1);
    // user openPosition
    const nextTimestamp2 = expectBucketData.lastUpdatedTimestamp + 3 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

    OpenPositionParams.marginParams.borrowedAmount = userBorrowedAmount;

    feeAmountCalculateWithETHRate = BigNumber.from(
      wadMul(userBorrowedAmount.add(depositAmount).toString(), protocolRate.toString()).toString(),
    );
    feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.mul(multiplierA).toString(), PriceInETH.toString()).toString();

    await positionManager.connect(user).openPosition(OpenPositionParams, { value: feeAmountInEth });

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp2, expectBucketData);
    expectBucketData.scaledTotalSupply = await debtToken.scaledTotalSupply();
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, expectBucketData.scaledTotalSupply);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp2;
    const bucketData2 = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData2);

    expectUserInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    expectUserInfo.oldBalance = await debtToken.scaledBalanceOf(user.address);
    const userInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, user.address);
    parseArguments(expectUserInfo, userInfo1);

    // trader openPosition second time
    amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    amountB = amountOut.mul(multiplierB);
    const price1 = wadDiv(swap.toString(), amountB.toString()).toString();
    const limitPrice1 = BigNumber.from(price1).div(multiplierA);
    await priceFeed.setAnswer(limitPrice1);

    const nextTimestamp3 = expectBucketData.lastUpdatedTimestamp + 3 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);

    OpenPositionParams.marginParams.borrowedAmount = traderBorrowedAmount2;

    feeAmountCalculateWithETHRate = BigNumber.from(
      wadMul(traderBorrowedAmount2.add(depositAmount).toString(), protocolRate.toString()).toString(),
    );
    feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.mul(multiplierA).toString(), PriceInETH.toString()).toString();

    await positionManager.connect(trader).openPosition(OpenPositionParams, { value: feeAmountInEth });

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp3, expectBucketData);
    expectBucketData.scaledTotalSupply = await debtToken.scaledTotalSupply();
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, expectBucketData.scaledTotalSupply);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp3;
    const bucketData3 = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData3);

    expectTraderInfo.fixedReward = calculateFixedReward(expectTraderInfo.oldBalance, expectBucketData.rewardIndex, expectTraderInfo);
    expectTraderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    expectTraderInfo.oldBalance = await debtToken.scaledBalanceOf(trader.address);

    const traderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
    parseArguments(expectTraderInfo, traderInfo2);

    // trader closePosition
    const nextTimestamp4 = expectBucketData.lastUpdatedTimestamp + 2 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp4]);
    await positionManager.connect(trader).closePosition(0, trader.address, closeRoute, 0);

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp4, expectBucketData);
    expectBucketData.scaledTotalSupply = await debtToken.scaledTotalSupply();
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, expectBucketData.scaledTotalSupply);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp4;
    const bucketData4 = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData4);

    expectTraderInfo.fixedReward = calculateFixedReward(expectTraderInfo.oldBalance, expectBucketData.rewardIndex, expectTraderInfo);
    expectTraderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    expectTraderInfo.oldBalance = await debtToken.scaledBalanceOf(trader.address);

    const traderInfo3 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
    parseArguments(expectTraderInfo, traderInfo3);
  });

  it("Step 2. ClaimReward", async function () {
    const traderBalanceVault = await getContract("TraderBalanceVault");

    // claim trader reward
    const nextTimestamp1 = expectBucketData.lastUpdatedTimestamp + 0.5 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);
    const rewardIndex = calculateRewardIndex(nextTimestamp1, expectBucketData);
    const fixedReward = calculateFixedReward(expectTraderInfo.oldBalance, rewardIndex, expectTraderInfo);
    const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, pmx.address);
    const tx = await activityRewardDistributor.connect(trader).claimReward([{ bucketAddress: bucket.address, role: Role.TRADER }]);
    await tx.wait();

    const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, pmx.address);
    expect(balanceAfter.sub(balanceBefore)).to.equal(fixedReward);

    expectBucketData.rewardIndex = rewardIndex;
    expectBucketData.lastUpdatedTimestamp = nextTimestamp1;
    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData);

    expectTraderInfo.fixedReward = BigNumber.from("0");
    expectTraderInfo.lastUpdatedRewardIndex = rewardIndex;
    expectTraderInfo.oldBalance = await debtToken.scaledBalanceOf(trader.address);

    const traderInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
    parseArguments(expectTraderInfo, traderInfo1);

    // claim user reward after all period
    const nextTimestamp2 = nextTimestamp1 + 12 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);
    const rewardIndex2 = calculateRewardIndex(nextTimestamp2, expectBucketData);
    const fixedReward2 = calculateFixedReward(expectUserInfo.oldBalance, rewardIndex2, expectUserInfo);
    const { availableBalance: balanceBefore2 } = await traderBalanceVault.balances(user.address, pmx.address);
    const tx2 = await activityRewardDistributor.connect(user).claimReward([{ bucketAddress: bucket.address, role: Role.TRADER }]);
    await tx2.wait();
    const { availableBalance: balanceAfter2 } = await traderBalanceVault.balances(user.address, pmx.address);
    expect(balanceAfter2.sub(balanceBefore2)).to.equal(fixedReward2);

    expectBucketData.rewardIndex = rewardIndex2;
    expectBucketData.lastUpdatedTimestamp = expectBucketData.endTimestamp;
    expectBucketData.isFinished = true;
    const bucketData2 = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData2);

    expectUserInfo.fixedReward = 0;
    expectUserInfo.lastUpdatedRewardIndex = rewardIndex2;
    expectUserInfo.oldBalance = await debtToken.scaledBalanceOf(user.address);
    const userInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, user.address);
    parseArguments(expectUserInfo, userInfo1);

    // claim trader reward after all period
    const nextTimestamp3 = nextTimestamp2 + 12 * 24 * 60 * 60;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);
    const { availableBalance: balanceBefore3 } = await traderBalanceVault.balances(trader.address, pmx.address);

    const tx3 = await activityRewardDistributor.connect(trader).claimReward([{ bucketAddress: bucket.address, role: Role.TRADER }]);
    await tx3.wait();
    const fixedReward3 = calculateFixedReward(expectTraderInfo.oldBalance, rewardIndex2, expectTraderInfo);

    const { availableBalance: balanceAfter3 } = await traderBalanceVault.balances(trader.address, pmx.address);
    expect(balanceAfter3.sub(balanceBefore3)).to.equal(fixedReward3);

    const bucketData3 = await activityRewardDistributor.buckets(bucket.address, Role.TRADER);
    parseArguments(expectBucketData, bucketData3);

    expectTraderInfo.fixedReward = BigNumber.from("0");
    expectTraderInfo.lastUpdatedRewardIndex = rewardIndex2;
    expectTraderInfo.oldBalance = await debtToken.scaledBalanceOf(trader.address);
    const traderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
    parseArguments(expectTraderInfo, traderInfo2);
  });
});
