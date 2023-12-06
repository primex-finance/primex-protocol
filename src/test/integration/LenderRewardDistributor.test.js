// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { parseArguments } = require("../utils/eventValidation");
const {
  calculateRewardPerToken,
  calculateRewardIndex,
  calculateFixedReward,
  calculateEndTimestamp,
  SECONDS_PER_DAY,
  Role,
} = require("../utils/activityRewardDistributorMath");

process.env.TEST = true;

describe("LenderRewardDistributor_integration", function () {
  let pmx, pToken, bucket, activityRewardDistributor, errors, testTokenA;
  let deployer, user, lender;
  let lenderAmount, userAmount, totalRewards, rewardPerDay;
  let expectBucketData, expectLenderInfo, expectUserInfo;
  before(async function () {
    await fixture(["Test"]);
    errors = await getContract("Errors");

    ({ deployer, lender, user } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    const decimalsA = await testTokenA.decimals();
    activityRewardDistributor = await getContract("ActivityRewardDistributor");
    pmx = await getContract("EPMXToken");
    const PrimexDNS = await getContract("PrimexDNS");

    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    pToken = await getContractAt("PToken", await bucket.pToken());
    await pToken.setLenderRewardDistributor(activityRewardDistributor.address);

    lenderAmount = parseUnits("50", decimalsA);
    userAmount = lenderAmount.mul(3);

    await testTokenA.mint(user.address, userAmount);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await testTokenA.connect(user).approve(bucket.address, MaxUint256);
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
    expectLenderInfo = {
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
  it("Step -1. Users who have not updated their balances after setupBucket do not participate in the distribution of rewards", async function () {
    await testTokenA.mint(deployer.address, userAmount);
    await testTokenA.approve(bucket.address, MaxUint256);
    await bucket["deposit(address,uint256,bool)"](deployer.address, userAmount, true);
  });

  it("Step 0. Should setup lender reward distributor", async function () {
    await pmx.approve(activityRewardDistributor.address, totalRewards);

    const nextTimestamp = (await provider.getBlock("latest")).timestamp + 2 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

    await expect(() =>
      activityRewardDistributor.setupBucket(bucket.address, Role.LENDER, totalRewards, rewardPerDay),
    ).to.changeTokenBalances(pmx, [activityRewardDistributor, deployer], [totalRewards, totalRewards.mul(NegativeOne)]);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp;
    expectBucketData.lastUpdatedRewardTimestamp = nextTimestamp;
    expectBucketData.totalReward = totalRewards;
    expectBucketData.rewardPerDay = rewardPerDay;
    expectBucketData.endTimestamp = calculateEndTimestamp(nextTimestamp, totalRewards, rewardPerDay);

    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData);
  });

  it("Step 1. Should update users activities after deposit and withdraw from bucket", async function () {
    // lender deposit
    const unusedTime = 2 * SECONDS_PER_DAY;
    const nextTimestamp1 = expectBucketData.lastUpdatedTimestamp + unusedTime;
    expectBucketData.endTimestamp = expectBucketData.endTimestamp.add(unusedTime);
    expectBucketData.lastUpdatedRewardTimestamp += unusedTime;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp1, expectBucketData);
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, lenderAmount);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp1;
    expectBucketData.scaledTotalSupply = lenderAmount;
    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData);

    expectLenderInfo.oldBalance = lenderAmount;
    expectLenderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const lenderInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
    parseArguments(expectLenderInfo, lenderInfo1);

    // user deposit
    const nextTimestamp2 = expectBucketData.lastUpdatedTimestamp + 4 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);
    await bucket.connect(user)["deposit(address,uint256,bool)"](user.address, userAmount, true);

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp2, expectBucketData);
    expectBucketData.scaledTotalSupply = lenderAmount.add(userAmount);
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, expectBucketData.scaledTotalSupply);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp2;
    const bucketData2 = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData2);

    expectUserInfo.oldBalance = userAmount;
    expectUserInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const userInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, user.address);
    parseArguments(expectUserInfo, userInfo1);

    // lender withdraw
    const nextTimestamp3 = expectBucketData.lastUpdatedTimestamp + 3 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);
    await bucket.connect(lender).withdraw(lender.address, lenderAmount.div(3));

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp3, expectBucketData);
    expectBucketData.scaledTotalSupply = lenderAmount.add(userAmount).sub(lenderAmount.div(3));
    expectBucketData.rewardPerToken = calculateRewardPerToken(expectBucketData.rewardPerDay, expectBucketData.scaledTotalSupply);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp3;
    const bucketData3 = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData3);

    expectLenderInfo.oldBalance = expectLenderInfo.oldBalance.sub(lenderAmount.div(3));
    expectLenderInfo.fixedReward = calculateFixedReward(lenderAmount, expectBucketData.rewardIndex, expectLenderInfo);
    expectLenderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const lenderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
    parseArguments(expectLenderInfo, lenderInfo2);

    lenderAmount = lenderAmount.sub(lenderAmount.div(3));
  });

  it("Step 2. Should update users activities after transfer and transferFrom PToken", async function () {
    // PToken transfer
    const nextTimestamp1 = expectBucketData.lastUpdatedTimestamp + 0.5 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);
    await pToken.connect(user).transfer(lender.address, userAmount.div(3));

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp1, expectBucketData);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp1;
    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData);

    expectLenderInfo.oldBalance = expectLenderInfo.oldBalance.add(userAmount.div(3));
    expectLenderInfo.fixedReward = calculateFixedReward(lenderAmount, expectBucketData.rewardIndex, expectLenderInfo);
    expectLenderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const lenderInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
    parseArguments(expectLenderInfo, lenderInfo1);

    expectUserInfo.oldBalance = expectUserInfo.oldBalance.sub(userAmount.div(3));
    expectUserInfo.fixedReward = calculateFixedReward(userAmount, expectBucketData.rewardIndex, expectUserInfo);
    expectUserInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const userInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, user.address);
    parseArguments(expectUserInfo, userInfo1);

    lenderAmount = lenderAmount.add(userAmount.div(3));
    userAmount = userAmount.sub(userAmount.div(3));

    // PToken transferFrom
    await pToken.connect(user).approve(deployer.address, userAmount.div(3));
    const nextTimestamp2 = expectBucketData.lastUpdatedTimestamp + 0.5 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);
    await pToken.connect(deployer).transferFrom(user.address, lender.address, userAmount.div(3));

    expectBucketData.rewardIndex = calculateRewardIndex(nextTimestamp2, expectBucketData);
    expectBucketData.lastUpdatedTimestamp = nextTimestamp2;
    const bucketData2 = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData2);

    expectLenderInfo.oldBalance = expectLenderInfo.oldBalance.add(userAmount.div(3));
    expectLenderInfo.fixedReward = calculateFixedReward(lenderAmount, expectBucketData.rewardIndex, expectLenderInfo);
    expectLenderInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const lenderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
    parseArguments(expectLenderInfo, lenderInfo2);

    expectUserInfo.oldBalance = expectUserInfo.oldBalance.sub(userAmount.div(3));
    expectUserInfo.fixedReward = calculateFixedReward(userAmount, expectBucketData.rewardIndex, expectUserInfo);
    expectUserInfo.lastUpdatedRewardIndex = expectBucketData.rewardIndex;
    const userInfo2 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, user.address);
    parseArguments(expectUserInfo, userInfo2);

    lenderAmount = lenderAmount.add(userAmount.div(3));
    userAmount = userAmount.sub(userAmount.div(3));
  });
  it("Step 3. ClaimReward", async function () {
    const traderBalanceVault = await getContract("TraderBalanceVault");

    // claim lender reward
    const nextTimestamp1 = expectBucketData.lastUpdatedTimestamp + 0.5 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);
    const rewardIndex = calculateRewardIndex(nextTimestamp1, expectBucketData);
    const fixedReward = calculateFixedReward(lenderAmount, rewardIndex, expectLenderInfo);
    const { availableBalance: balanceBefore } = await traderBalanceVault.balances(lender.address, pmx.address);

    const tx = await activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: bucket.address, role: Role.LENDER }]);
    await tx.wait();

    const { availableBalance: balanceAfter } = await traderBalanceVault.balances(lender.address, pmx.address);
    expect(balanceAfter.sub(balanceBefore)).to.equal(fixedReward);

    expectBucketData.rewardIndex = rewardIndex;
    expectBucketData.lastUpdatedTimestamp = nextTimestamp1;
    const bucketData = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData);

    expectLenderInfo.fixedReward = BigNumber.from("0");
    expectLenderInfo.lastUpdatedRewardIndex = rewardIndex;
    const lenderInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
    parseArguments(expectLenderInfo, lenderInfo1);

    // claim user reward after all period
    const nextTimestamp2 = nextTimestamp1 + 12 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);
    const rewardIndex2 = calculateRewardIndex(nextTimestamp2, expectBucketData);
    const fixedReward2 = calculateFixedReward(userAmount, rewardIndex2, expectUserInfo);
    const { availableBalance: balanceBefore2 } = await traderBalanceVault.balances(user.address, pmx.address);
    const tx2 = await activityRewardDistributor.connect(user).claimReward([{ bucketAddress: bucket.address, role: Role.LENDER }]);
    await tx2.wait();
    const { availableBalance: balanceAfter2 } = await traderBalanceVault.balances(user.address, pmx.address);
    expect(balanceAfter2.sub(balanceBefore2)).to.equal(fixedReward2);

    expectBucketData.rewardIndex = rewardIndex2;
    expectBucketData.lastUpdatedTimestamp = expectBucketData.endTimestamp;
    expectBucketData.isFinished = true;
    const bucketData2 = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData2);

    expectUserInfo.fixedReward = 0;
    expectUserInfo.lastUpdatedRewardIndex = rewardIndex2;
    const userInfo1 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, user.address);
    parseArguments(expectUserInfo, userInfo1);

    const nextTimestamp3 = nextTimestamp2 + 12 * SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);
    const { availableBalance: balanceBefore3 } = await traderBalanceVault.balances(lender.address, pmx.address);
    const tx3 = await activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: bucket.address, role: Role.LENDER }]);
    await tx3.wait();
    const fixedReward3 = calculateFixedReward(lenderAmount, rewardIndex2, expectLenderInfo);

    const { availableBalance: balanceAfter3 } = await traderBalanceVault.balances(lender.address, pmx.address);
    expect(balanceAfter3.sub(balanceBefore3)).to.equal(fixedReward3);

    const bucketData3 = await activityRewardDistributor.buckets(bucket.address, Role.LENDER);
    parseArguments(expectBucketData, bucketData3);

    expectLenderInfo.fixedReward = BigNumber.from("0");
    expectLenderInfo.lastUpdatedRewardIndex = rewardIndex2;
    const lenderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
    parseArguments(expectLenderInfo, lenderInfo2);
  });
  it("Step 4. New user don't have rewards after finish bucket(fixed bug)", async function () {
    await testTokenA.mint(deployer.address, userAmount);
    await testTokenA.approve(bucket.address, MaxUint256);
    await bucket["deposit(address,uint256,bool)"](deployer.address, userAmount, true);

    expect(
      await activityRewardDistributor.getClaimableReward([{ bucketAddress: bucket.address, role: Role.LENDER }], deployer.address),
    ).to.equal(0);
    await expect(
      activityRewardDistributor.connect(deployer).claimReward([{ bucketAddress: bucket.address, role: Role.LENDER }]),
    ).to.be.revertedWithCustomError(errors, "REWARD_AMOUNT_IS_ZERO");
  });
});
