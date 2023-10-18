// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    BigNumber,
    provider,
    getNamedSigners,
    getContractFactory,
    constants: { MaxUint256 },
    utils: { parseUnits },
  },
} = require("hardhat");
const { parseEther } = require("ethers/lib/utils");
const {
  deployMockPMXToken,
  deployMockBucket,
  deployMockWhiteBlackList,
  deployMockPToken,
  deployMockDebtToken,
  deployMockPrimexDNS,
  deployMockAccessControl,
  deployMockTraderBalanceVault,
  deployMockTreasury,
} = require("../utils/waffleMocks");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const { parseArguments } = require("../utils/eventValidation");
const { MEDIUM_TIMELOCK_ADMIN, EMERGENCY_ADMIN, SMALL_TIMELOCK_ADMIN, BIG_TIMELOCK_ADMIN } = require("../../Constants");
const { WAD } = require("../utils/constants");

process.env.TEST = true;
const increaseAmount = parseEther("20");
const rewardPerDay = parseEther("2");

const { calculateRewardPerToken, calculateEndTimestamp, Role, SECONDS_PER_DAY } = require("../utils/activityRewardDistributorMath");
const { ZERO_ADDRESS } = require("@aave/deploy-v3");

function calculateFixedReward(oldBalance, rewardIndex, lastUpdatedRewardIndex, previosFixedReward = BigNumber.from(0)) {
  return previosFixedReward.add(oldBalance.mul(rewardIndex.sub(lastUpdatedRewardIndex)).div(WAD));
}

function calculateRewardIndex(rewardPerToken, currentTimestamp, bucketLastUpdatedTimestamp, previosRewardIndex = BigNumber.from(0)) {
  return previosRewardIndex.add(rewardPerToken.mul(currentTimestamp - bucketLastUpdatedTimestamp));
}

describe("ActivityRewardDistributor_unit", function () {
  let activityRewardDistributor, activityRewardDistributorFactory;
  let errorsLibrary;
  let deployer, caller, lender, recipient, PToken1Signer;
  let mockBucket1, mockPToken1, mockDNS, mockRegistry, mockTreasury, mockPMX, attackerBucket1, mockTraderBalanceVault, mockWhiteBlackList;
  let args;
  let snapshotId;
  let scaledPTokenTotalSupply, newBalance;
  let expectBucketData, nextTimestamp, usersLength, name1;

  before(async function () {
    usersLength = 2;
    errorsLibrary = await getContractFactory("Errors");

    ({ deployer, lender, caller, recipient } = await getNamedSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, caller.address).returns(false);

    mockDNS = await deployMockPrimexDNS(deployer);
    mockPMX = await deployMockPMXToken(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    mockTraderBalanceVault = await deployMockTraderBalanceVault(deployer);
    mockTreasury = await deployMockTreasury(deployer);

    mockPToken1 = await deployMockPToken(deployer);
    const pTokenDecimals = 8;
    scaledPTokenTotalSupply = parseUnits("100000", pTokenDecimals);
    newBalance = parseUnits("100", pTokenDecimals);

    await mockPToken1.mock.decimals.returns(pTokenDecimals);
    await mockPToken1.mock.scaledTotalSupply.returns(scaledPTokenTotalSupply);

    PToken1Signer = await getImpersonateSigner(mockPToken1);
    name1 = "bucket1";
    mockBucket1 = await deployMockBucket(deployer);
    await mockBucket1.mock.name.returns(name1);
    await mockBucket1.mock.pToken.returns(mockPToken1.address);

    // bucketAddress,currentStatus,delistingDeadline,adminDeadline
    await mockDNS.mock.buckets.withArgs(name1).returns(mockBucket1.address, 1, 0, 0);

    const AttackerBucketFactory = await getContractFactory("AttackerBucket");
    attackerBucket1 = await AttackerBucketFactory.deploy();
    await attackerBucket1.setName(name1);

    args = [
      mockPMX.address,
      mockDNS.address,
      mockRegistry.address,
      mockTreasury.address,
      mockTraderBalanceVault.address,
      mockWhiteBlackList.address,
    ];

    activityRewardDistributorFactory = await getContractFactory("ActivityRewardDistributor");
    activityRewardDistributor = await upgrades.deployProxy(activityRewardDistributorFactory, [...args], {
      unsafeAllow: ["constructor", "delegatecall"],
    });

    await activityRewardDistributor.deployed();
  });

  beforeEach(async function () {
    args = [
      mockPMX.address,
      mockDNS.address,
      mockRegistry.address,
      mockTreasury.address,
      mockTraderBalanceVault.address,
      mockWhiteBlackList.address,
    ];
    nextTimestamp = (await provider.getBlock("latest")).timestamp + 100;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

    expectBucketData = {
      rewardIndex: 0,
      lastUpdatedTimestamp: nextTimestamp,
      rewardPerToken: 0,
      scaledTotalSupply: 0,
      isFinished: false,
      fixedReward: 0,
      lastUpdatedRewardTimestamp: nextTimestamp,
      rewardPerDay: rewardPerDay,
      totalReward: increaseAmount,
      endTimestamp: 0,
    };
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });
  async function initialSetup(caller) {
    // initial setup
    await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay);
    const nextTimestamp1 = nextTimestamp + SECONDS_PER_DAY;
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);

    await activityRewardDistributor.connect(PToken1Signer).updateUserActivity(mockBucket1.address, caller, newBalance, Role.LENDER);

    const endTimestamp = calculateEndTimestamp(nextTimestamp1, increaseAmount, rewardPerDay);

    const expectBucketData2 = {
      rewardIndex: BigNumber.from("0"),
      lastUpdatedTimestamp: nextTimestamp1,
      rewardPerToken: calculateRewardPerToken(rewardPerDay, newBalance),
      scaledTotalSupply: newBalance,
      isFinished: false,
      fixedReward: BigNumber.from("0"),
      lastUpdatedRewardTimestamp: nextTimestamp1,
      rewardPerDay: rewardPerDay,
      totalReward: increaseAmount,
      endTimestamp: endTimestamp,
    };

    parseArguments(expectBucketData2, await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER));
    const lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, caller);
    const expectLenderInfo = {
      fixedReward: BigNumber.from("0"),
      lastUpdatedRewardIndex: expectBucketData2.rewardIndex,
      oldBalance: newBalance,
    };
    parseArguments(expectLenderInfo, lenderInfo);
    return { bucketData: expectBucketData2, lenderInfo: expectLenderInfo };
  }
  describe("initialize", function () {
    it("Should deploy", async function () {
      expect(await upgrades.deployProxy(activityRewardDistributorFactory, [...args], { unsafeAllow: ["constructor", "delegatecall"] }));
    });
    it("Should revert initialize when the registry is not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(activityRewardDistributorFactory, [...args], { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the PrimexDNS is not supported", async function () {
      await mockDNS.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(activityRewardDistributorFactory, [...args], { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the PMX address is not supported", async function () {
      await mockPMX.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(activityRewardDistributorFactory, [...args], { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the TraderBalanceVault is not supported", async function () {
      await mockTraderBalanceVault.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(activityRewardDistributorFactory, [...args], { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the WhiteBlackList is not supported", async function () {
      await mockWhiteBlackList.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(activityRewardDistributorFactory, [...args], { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("withdrawPmx", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call withdrawPmx", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(
        activityRewardDistributor.connect(caller).withdrawPmx(mockBucket1.address, Role.LENDER, parseEther("1")),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("Should revert while attempt to withdraw more than availablePMX", async function () {
      await expect(activityRewardDistributor.withdrawPmx(mockBucket1.address, Role.LENDER, parseEther("1"))).to.be.revertedWithCustomError(
        errorsLibrary,
        "AMOUNT_EXCEEDS_AVAILABLE_BALANCE",
      );
    });

    it("Should successfully withdrawPmx", async function () {
      const withdrawAmount = increaseAmount.div("2");
      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay);
      await expect(activityRewardDistributor.withdrawPmx(mockBucket1.address, Role.LENDER, withdrawAmount)).not.to.be.reverted;
    });

    it("withdrawPmx should correct update state", async function () {
      const withdrawAmount = increaseAmount.div("2");
      const { bucketData } = await initialSetup(lender.address);

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + 100;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      await activityRewardDistributor.withdrawPmx(mockBucket1.address, Role.LENDER, withdrawAmount);

      const fixedReward = bucketData.rewardPerDay.mul(nextTimestamp - bucketData.lastUpdatedRewardTimestamp).div(SECONDS_PER_DAY);
      bucketData.totalReward = bucketData.totalReward.sub(withdrawAmount);
      bucketData.endTimestamp = calculateEndTimestamp(nextTimestamp, bucketData.totalReward, bucketData.rewardPerDay, fixedReward);
      const bucketData2 = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);

      parseArguments(bucketData, bucketData2);
      // there's no revert with zero amount
      expect(await activityRewardDistributor.withdrawPmx(mockBucket1.address, Role.LENDER, 0));
    });
  });

  describe("setupBucket & decreaseRewardPerDay", function () {
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setupBucket", async function () {
      await expect(
        activityRewardDistributor.connect(caller).setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not EMERGENCY_ADMIN call decreaseRewardPerDay", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, caller.address).returns(false);
      await expect(
        activityRewardDistributor.connect(caller).decreaseRewardPerDay(mockBucket1.address, Role.LENDER, rewardPerDay),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should transfer pmx from msg.sender in activityRewardDistributor", async function () {
      await mockPMX.mock.transferFrom.reverts();
      await mockPMX.mock.transferFrom.withArgs(deployer.address, activityRewardDistributor.address, increaseAmount).returns(true);

      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay);
    });
    describe("initial setup", function () {
      it("Should revert decreaseRewardPerDay if the passed value is greater than the current one", async function () {
        await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, 0, rewardPerDay);
        await expect(
          activityRewardDistributor.decreaseRewardPerDay(mockBucket1.address, Role.LENDER, rewardPerDay.add("1")),
        ).to.be.revertedWithCustomError(errorsLibrary, "REWARD_PER_DAY_IS_NOT_CORRECT");
      });
      it("Should setup only totalReward", async function () {
        const zeroRewardPerDay = 0;
        await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, zeroRewardPerDay);
        expectBucketData.rewardPerDay = zeroRewardPerDay;
        expectBucketData.endTimestamp = MaxUint256;
        const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
        parseArguments(expectBucketData, bucketData);
      });

      it("Should setup only reward per day when ptokens totalSupply isn't 0", async function () {
        const zeroIncreaseAmount = BigNumber.from("0");
        await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, zeroIncreaseAmount, rewardPerDay);
        expectBucketData.totalReward = zeroIncreaseAmount;
        expectBucketData.endTimestamp = calculateEndTimestamp(nextTimestamp, zeroIncreaseAmount, rewardPerDay);
        const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
        parseArguments(expectBucketData, bucketData);
        // there's no revert
        expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER));
      });

      it("Should setup reward per day and totalReward", async function () {
        await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay);
        expectBucketData.endTimestamp = calculateEndTimestamp(nextTimestamp, increaseAmount, rewardPerDay);

        const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
        parseArguments(expectBucketData, bucketData);
      });
      describe("second setup", function () {
        it("Should setup reward per day and totalReward while totalReward is smaller than accumulated bucket reward", async function () {
          const { bucketData: expectBucketData2 } = await initialSetup(deployer.address);

          const accumulatedReward = await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER);
          expect(expectBucketData2.totalReward.gt(accumulatedReward)).to.equal(true);

          const nextTimestamp2 = (await provider.getBlock("latest")).timestamp + 100;
          await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

          await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay.mul(2));

          expectBucketData2.fixedReward = expectBucketData2.rewardPerDay
            .mul(nextTimestamp2 - expectBucketData2.lastUpdatedRewardTimestamp)
            .div(SECONDS_PER_DAY);
          expectBucketData2.rewardIndex = calculateRewardIndex(
            expectBucketData2.rewardPerToken,
            nextTimestamp2,
            expectBucketData2.lastUpdatedTimestamp,
          );
          expectBucketData2.rewardPerToken = calculateRewardPerToken(rewardPerDay.mul(2), expectBucketData2.scaledTotalSupply);
          expectBucketData2.rewardPerDay = rewardPerDay.mul(2);
          expectBucketData2.lastUpdatedTimestamp = nextTimestamp2;
          expectBucketData2.lastUpdatedRewardTimestamp = nextTimestamp2;
          expectBucketData2.totalReward = increaseAmount.mul(2);
          expectBucketData2.endTimestamp = calculateEndTimestamp(
            nextTimestamp2,
            increaseAmount.mul(2),
            rewardPerDay.mul(2),
            expectBucketData2.fixedReward,
          );

          const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
          parseArguments(expectBucketData2, bucketData);
        });
        it("Should setup reward per day and totalReward while totalReward is equal accumulated bucket reward", async function () {
          const { bucketData: expectBucketData2 } = await initialSetup(deployer.address);

          await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp + 11 * SECONDS_PER_DAY]);
          await network.provider.send("evm_mine");
          const nextTimestamp1 = (await provider.getBlock("latest")).timestamp + 100;
          await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);

          expect(expectBucketData2.endTimestamp.lt(nextTimestamp1)).to.equal(true);

          const accumulatedReward = await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER);
          expect(accumulatedReward).to.equal(expectBucketData2.totalReward);

          await activityRewardDistributor
            .connect(PToken1Signer)
            .updateUserActivity(mockBucket1.address, deployer.address, "100", Role.LENDER);

          expectBucketData2.isFinished = true;
          expectBucketData2.rewardIndex = calculateRewardIndex(
            expectBucketData2.rewardPerToken,
            expectBucketData2.endTimestamp,
            expectBucketData2.lastUpdatedTimestamp,
          );
          expectBucketData2.scaledTotalSupply = "100";
          expectBucketData2.rewardPerToken = calculateRewardPerToken(rewardPerDay, expectBucketData2.scaledTotalSupply);
          expectBucketData2.lastUpdatedTimestamp = expectBucketData2.endTimestamp;
          let bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
          parseArguments(expectBucketData2, bucketData);

          const nextTimestamp2 = (await provider.getBlock("latest")).timestamp + 100;
          await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

          await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay.mul(2));

          expectBucketData2.fixedReward = expectBucketData2.totalReward;

          expectBucketData2.rewardPerDay = rewardPerDay.mul(2);

          expectBucketData2.lastUpdatedTimestamp = nextTimestamp2;
          expectBucketData2.lastUpdatedRewardTimestamp = nextTimestamp2;
          expectBucketData2.isFinished = false;
          expectBucketData2.totalReward = expectBucketData2.totalReward.add(increaseAmount);
          expectBucketData2.endTimestamp = calculateEndTimestamp(nextTimestamp2, increaseAmount, expectBucketData2.rewardPerDay);
          expectBucketData2.rewardPerToken = calculateRewardPerToken(expectBucketData2.rewardPerDay, expectBucketData2.scaledTotalSupply);

          bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
          parseArguments(expectBucketData2, bucketData);
        });
        it("decreaseRewardPerDay should setup reward per day 0 ", async function () {
          const { bucketData: expectBucketData2 } = await initialSetup(deployer.address);

          const nextTimestamp2 = (await provider.getBlock("latest")).timestamp + 100;
          await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

          await activityRewardDistributor.decreaseRewardPerDay(mockBucket1.address, Role.LENDER, 0);

          expectBucketData2.fixedReward = expectBucketData2.rewardPerDay
            .mul(nextTimestamp2 - expectBucketData2.lastUpdatedRewardTimestamp)
            .div(SECONDS_PER_DAY);
          expectBucketData2.rewardIndex = calculateRewardIndex(
            expectBucketData2.rewardPerToken,
            nextTimestamp2,
            expectBucketData2.lastUpdatedTimestamp,
          );
          expectBucketData2.rewardPerToken = 0;
          expectBucketData2.rewardPerDay = 0;
          expectBucketData2.lastUpdatedTimestamp = nextTimestamp2;
          expectBucketData2.lastUpdatedRewardTimestamp = nextTimestamp2;
          expectBucketData2.endTimestamp = MaxUint256;

          const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
          parseArguments(expectBucketData2, bucketData);
        });
        it("decreaseRewardPerDay should setup a new value as the reward per day", async function () {
          const { bucketData: expectBucketData2 } = await initialSetup(deployer.address);

          const nextTimestamp2 = (await provider.getBlock("latest")).timestamp + 100;
          await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

          await activityRewardDistributor.decreaseRewardPerDay(mockBucket1.address, Role.LENDER, rewardPerDay.div("2"));

          expectBucketData2.fixedReward = expectBucketData2.rewardPerDay
            .mul(nextTimestamp2 - expectBucketData2.lastUpdatedRewardTimestamp)
            .div(SECONDS_PER_DAY);

          expectBucketData2.rewardPerDay = rewardPerDay.div("2");

          expectBucketData2.rewardIndex = calculateRewardIndex(
            expectBucketData2.rewardPerToken,
            nextTimestamp2,
            expectBucketData2.lastUpdatedTimestamp,
          );
          expectBucketData2.rewardPerToken = calculateRewardPerToken(expectBucketData2.rewardPerDay, expectBucketData2.scaledTotalSupply);
          expectBucketData2.lastUpdatedTimestamp = nextTimestamp2;
          expectBucketData2.lastUpdatedRewardTimestamp = nextTimestamp2;
          expectBucketData2.endTimestamp = calculateEndTimestamp(
            nextTimestamp2,
            expectBucketData2.totalReward,
            expectBucketData2.rewardPerDay,
            expectBucketData2.fixedReward,
          );

          const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
          parseArguments(expectBucketData2, bucketData);
        });
      });
    });
  });

  describe("updateUserActivity & updateUsersActivities", function () {
    let users;
    let balances;
    before(async function () {
      users = [lender.address, recipient.address];
      balances = [newBalance, newBalance.mul(2)];
    });
    it("updateUserActivity should revert if bucket is not in primex system", async function () {
      await expect(
        activityRewardDistributor.connect(caller).updateUserActivity(attackerBucket1.address, lender.address, newBalance, Role.LENDER),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("updateUserActivity should revert if bucket is zero address", async function () {
      await mockDNS.mock.buckets.withArgs(name1).returns(ZERO_ADDRESS, 1, 0, 0);
      await expect(
        activityRewardDistributor.connect(caller).updateUserActivity(mockBucket1.address, lender.address, newBalance, Role.LENDER),
      ).to.be.revertedWithCustomError(errorsLibrary, "ZERO_BUCKET_ADDRESS");
    });
    it("updateUserActivity should revert if msg.sender is not ptoken of sended bucket", async function () {
      await expect(
        activityRewardDistributor.connect(caller).updateUserActivity(mockBucket1.address, lender.address, newBalance, Role.LENDER),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("updateUsersActivities should revert if bucket is not in primex system", async function () {
      await expect(
        activityRewardDistributor.connect(caller).updateUsersActivities(attackerBucket1.address, users, balances, usersLength, Role.LENDER),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("updateUsersActivities should revert if msg.sender is not ptoken of sended bucket", async function () {
      await expect(
        activityRewardDistributor.connect(caller).updateUsersActivities(mockBucket1.address, users, balances, usersLength, Role.LENDER),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("updateUserActivity & updateUsersActivities should not set user's and bucket's paramms if totalReward in bucket is 0", async function () {
      // updateUserActivity
      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, lender.address, newBalance, Role.LENDER);
      expectBucketData.lastUpdatedTimestamp = 0;
      expectBucketData.lastUpdatedRewardTimestamp = 0;
      expectBucketData.rewardPerDay = 0;
      expectBucketData.totalReward = 0;
      const expectLenderInfo = {
        fixedReward: 0,
        lastUpdatedRewardIndex: 0,
        oldBalance: 0,
      };
      let bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData, bucketData);
      let lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, lender.address);
      parseArguments(expectLenderInfo, lenderInfo);

      // updateUsersActivities
      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUsersActivities(mockBucket1.address, users, balances, usersLength, Role.LENDER);
      bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData, bucketData);
      lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users[0]);
      parseArguments(expectLenderInfo, lenderInfo);
      lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users[1]);
      parseArguments(expectLenderInfo, lenderInfo);
    });

    it("updateUserActivity & updateUsersActivities should not set user's and bucket's paramms if rewardPerDay in bucket is 0", async function () {
      const zeroRewardPerDay = 0;
      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, zeroRewardPerDay);
      expectBucketData.endTimestamp = MaxUint256;
      // updateUserActivity
      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, lender.address, newBalance, Role.LENDER);

      expectBucketData.rewardPerDay = zeroRewardPerDay;
      const expectLenderInfo = {
        fixedReward: 0,
        lastUpdatedRewardIndex: 0,
        oldBalance: 0,
      };
      let bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData, bucketData);
      let lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, lender.address);
      parseArguments(expectLenderInfo, lenderInfo);

      // updateUsersActivities
      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUsersActivities(mockBucket1.address, users, balances, usersLength, Role.LENDER);
      bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData, bucketData);
      lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users[0]);
      parseArguments(expectLenderInfo, lenderInfo);
      lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users[1]);
      parseArguments(expectLenderInfo, lenderInfo);
    });

    it("updateUserActivity should set bucket.isFinished is true and for next updateUserActivity not set user's and bucket's paramms", async function () {
      const { bucketData: expectBucketData2 } = await initialSetup(deployer.address);

      const nextTimestamp2 = expectBucketData2.lastUpdatedTimestamp + 12 * SECONDS_PER_DAY;
      expect(expectBucketData2.endTimestamp.lt(nextTimestamp2)).to.equal(true);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, deployer.address, newBalance.mul(2), Role.LENDER);

      expectBucketData2.isFinished = true;
      expectBucketData2.rewardIndex = calculateRewardIndex(
        expectBucketData2.rewardPerToken,
        expectBucketData2.endTimestamp,
        expectBucketData2.lastUpdatedTimestamp,
      );
      expectBucketData2.lastUpdatedTimestamp = expectBucketData2.endTimestamp;
      expectBucketData2.rewardPerToken = calculateRewardPerToken(rewardPerDay, newBalance.mul(2));
      expectBucketData2.scaledTotalSupply = newBalance.mul(2);

      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(increaseAmount);
      const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData2, bucketData);

      // updateUserActivity
      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, lender.address, newBalance, Role.LENDER);

      const expectLenderInfo = {
        fixedReward: 0,
        lastUpdatedRewardIndex: 0,
        oldBalance: 0,
      };

      const lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, lender.address);
      parseArguments(expectLenderInfo, lenderInfo);
    });

    it("updateUsersActivities should set bucket.isFinished = true and next updateUsersActivities should not update user and bucket params", async function () {
      const { bucketData: expectBucketData2 } = await initialSetup(deployer.address);

      const nextTimestamp2 = expectBucketData2.lastUpdatedTimestamp + 12 * SECONDS_PER_DAY;
      expect(expectBucketData2.endTimestamp.lt(nextTimestamp2)).to.equal(true);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, deployer.address, newBalance.mul(2), Role.LENDER);

      expectBucketData2.isFinished = true;
      expectBucketData2.rewardIndex = calculateRewardIndex(
        expectBucketData2.rewardPerToken,
        expectBucketData2.endTimestamp,
        expectBucketData2.lastUpdatedTimestamp,
      );
      expectBucketData2.lastUpdatedTimestamp = expectBucketData2.endTimestamp;
      expectBucketData2.rewardPerToken = calculateRewardPerToken(rewardPerDay, newBalance.mul(2));
      expectBucketData2.scaledTotalSupply = newBalance.mul(2);

      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(increaseAmount);
      const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData2, bucketData);

      const users2 = [caller.address, lender.address];
      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUsersActivities(mockBucket1.address, users2, balances, usersLength, Role.LENDER);

      const expectLenderInfo = {
        fixedReward: 0,
        lastUpdatedRewardIndex: 0,
        oldBalance: 0,
      };

      let lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users2[0]);
      parseArguments(expectLenderInfo, lenderInfo);
      lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users2[1]);
      parseArguments(expectLenderInfo, lenderInfo);
    });

    it("updateUserActivity should set user's and bucket's paramms", async function () {
      const { bucketData: expectBucketData2, lenderInfo: expectLenderInfo } = await initialSetup(deployer.address);

      const nextTimestamp2 = expectBucketData2.lastUpdatedTimestamp + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, deployer.address, newBalance.mul(2), Role.LENDER);

      expectBucketData2.rewardIndex = calculateRewardIndex(
        expectBucketData2.rewardPerToken,
        nextTimestamp2,
        expectBucketData2.lastUpdatedTimestamp,
      );
      expectBucketData2.lastUpdatedTimestamp = nextTimestamp2;
      expectBucketData2.rewardPerToken = calculateRewardPerToken(rewardPerDay, newBalance.mul(2));
      expectBucketData2.scaledTotalSupply = newBalance.mul(2);

      const bucketData = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(expectBucketData2, bucketData);

      expectLenderInfo.fixedReward = calculateFixedReward(
        expectLenderInfo.oldBalance,
        expectBucketData2.rewardIndex,
        expectLenderInfo.lastUpdatedRewardIndex,
      );
      expectLenderInfo.lastUpdatedRewardIndex = expectBucketData2.rewardIndex;
      expectLenderInfo.oldBalance = newBalance.mul(2);

      const lenderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, deployer.address);
      parseArguments(expectLenderInfo, lenderInfo2);
    });

    it("updateUsersActivities should set users' and bucket's paramms", async function () {
      const { bucketData: expectBucketData2, lenderInfo: expectLenderInfo } = await initialSetup(users[0]);

      const nextTimestamp2 = expectBucketData2.lastUpdatedTimestamp + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUsersActivities(mockBucket1.address, users, balances, usersLength, Role.LENDER);

      expectBucketData2.rewardIndex = calculateRewardIndex(
        expectBucketData2.rewardPerToken,
        nextTimestamp2,
        expectBucketData2.lastUpdatedTimestamp,
      );
      expectBucketData2.lastUpdatedTimestamp = nextTimestamp2;
      parseArguments(expectBucketData2, await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER));

      expectLenderInfo.fixedReward = calculateFixedReward(
        expectLenderInfo.oldBalance,
        expectBucketData2.rewardIndex,
        expectLenderInfo.lastUpdatedRewardIndex,
      );
      expectLenderInfo.lastUpdatedRewardIndex = expectBucketData2.rewardIndex;
      expectLenderInfo.oldBalance = balances[0];

      const lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users[0]);
      parseArguments(expectLenderInfo, lenderInfo);

      const expectLenderInfo1 = {
        fixedReward: 0,
        lastUpdatedRewardIndex: expectBucketData2.rewardIndex,
        oldBalance: balances[1],
      };

      const lenderInfo1 = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, users[1]);
      parseArguments(expectLenderInfo1, lenderInfo1);
    });

    it("updateUserActivity should set bucket.unusedTime if rewardPerToken is 0", async function () {
      // initial setup
      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay);
      expect((await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER)).rewardPerToken).to.equal(0);

      const nextTimestamp1 = nextTimestamp + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, deployer.address, newBalance, Role.LENDER);

      const endTimestamp = calculateEndTimestamp(nextTimestamp1, increaseAmount, rewardPerDay);

      const expectBucketData2 = {
        rewardIndex: 0,
        lastUpdatedTimestamp: nextTimestamp1,
        rewardPerToken: calculateRewardPerToken(rewardPerDay, newBalance),
        scaledTotalSupply: newBalance,
        isFinished: false,
        fixedReward: 0,
        lastUpdatedRewardTimestamp: nextTimestamp1,
        rewardPerDay: rewardPerDay,
        totalReward: increaseAmount,
        endTimestamp: endTimestamp,
      };
      parseArguments(expectBucketData2, await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER));
      const lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, deployer.address);
      const expectLenderInfo = {
        fixedReward: 0,
        lastUpdatedRewardIndex: expectBucketData2.rewardIndex,
        oldBalance: newBalance,
      };
      parseArguments(expectLenderInfo, lenderInfo);
    });
  });

  describe("claimReward & getBucketAccumulatedReward", function () {
    it("getBucketAccumulatedReward should return 0 if bucket.lastUpdatedRewardTimestamp is 0", async function () {
      expect(
        await activityRewardDistributor.getClaimableReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }], lender.address),
      ).to.equal(0);
    });

    it("claim should revert if the msg.sender is on the blacklist", async function () {
      await mockWhiteBlackList.mock.isBlackListed.returns(true);
      await expect(
        activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }]),
      ).to.be.revertedWithCustomError(errorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert claimReward if activityRewardDistributor is paused", async function () {
      await activityRewardDistributor.pause();
      await expect(
        activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }]),
      ).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert claimReward if total reward is zero", async function () {
      await expect(
        activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }]),
      ).to.be.revertedWithCustomError(errorsLibrary, "TOTAL_REWARD_AMOUNT_IS_ZERO");
    });
    it("reward is lender.fixedReward if oldBalance is 0", async function () {
      const { bucketData, lenderInfo } = await initialSetup(lender.address);

      const nextTimestamp2 = expectBucketData.lastUpdatedTimestamp + 2 * SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      await activityRewardDistributor.connect(PToken1Signer).updateUserActivity(mockBucket1.address, lender.address, 0, Role.LENDER);

      const rewardIndex2 = calculateRewardIndex(bucketData.rewardPerToken, nextTimestamp2, bucketData.lastUpdatedTimestamp);
      const fixedReward = calculateFixedReward(lenderInfo.oldBalance, rewardIndex2, lenderInfo.lastUpdatedRewardIndex);

      await mockTraderBalanceVault.mock.topUpAvailableBalance.reverts();
      await mockTraderBalanceVault.mock.topUpAvailableBalance.withArgs(lender.address, mockPMX.address, fixedReward).returns();

      expect(
        await activityRewardDistributor.getClaimableReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }], lender.address),
      ).to.equal(fixedReward);
      await activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }]);
    });
    it("claimReward should correct update state", async function () {
      // first update
      const { lenderInfo, bucketData } = await initialSetup(lender.address);
      //

      // second update
      const nextTimestamp2 = bucketData.lastUpdatedTimestamp + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      const newBalance2 = newBalance.mul(2);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, lender.address, newBalance2, Role.LENDER);

      bucketData.rewardIndex = calculateRewardIndex(
        bucketData.rewardPerToken,
        nextTimestamp2,
        bucketData.lastUpdatedTimestamp,
        bucketData.rewardIndex,
      );
      bucketData.scaledTotalSupply = newBalance2;
      bucketData.rewardPerToken = calculateRewardPerToken(bucketData.rewardPerDay, bucketData.scaledTotalSupply);
      bucketData.lastUpdatedTimestamp = nextTimestamp2;

      lenderInfo.fixedReward = calculateFixedReward(
        lenderInfo.oldBalance,
        bucketData.rewardIndex,
        lenderInfo.lastUpdatedRewardIndex,
        lenderInfo.fixedReward,
      );
      lenderInfo.oldBalance = newBalance2;
      lenderInfo.lastUpdatedRewardIndex = bucketData.rewardIndex;
      //

      // third update
      const nextTimestamp3 = nextTimestamp2 + 12 * SECONDS_PER_DAY;

      bucketData.rewardIndex = calculateRewardIndex(
        bucketData.rewardPerToken,
        bucketData.endTimestamp,
        bucketData.lastUpdatedTimestamp,
        bucketData.rewardIndex,
      );
      bucketData.lastUpdatedTimestamp = bucketData.endTimestamp;
      bucketData.isFinished = true;

      lenderInfo.fixedReward = calculateFixedReward(
        lenderInfo.oldBalance,
        bucketData.rewardIndex,
        lenderInfo.lastUpdatedRewardIndex,
        lenderInfo.fixedReward,
      );

      await mockTraderBalanceVault.mock.topUpAvailableBalance.reverts();
      await mockTraderBalanceVault.mock.topUpAvailableBalance.withArgs(lender.address, mockPMX.address, lenderInfo.fixedReward).returns();

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);

      await expect(activityRewardDistributor.connect(lender).claimReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }]))
        .to.emit(activityRewardDistributor, "ClaimReward")
        .withArgs(lender.address, mockBucket1.address, Role.LENDER, lenderInfo.fixedReward);

      const bucketData2 = await activityRewardDistributor.buckets(mockBucket1.address, Role.LENDER);
      parseArguments(bucketData, bucketData2);

      lenderInfo.fixedReward = 0;
      lenderInfo.lastUpdatedRewardIndex = bucketData.rewardIndex;
      const lenderInfo2 = await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, lender.address);
      parseArguments(lenderInfo, lenderInfo2);
      //
    });
    it("getClaimableReward should return correct value", async function () {
      // first update
      const { lenderInfo, bucketData } = await initialSetup(lender.address);
      //

      // second update
      const nextTimestamp2 = bucketData.lastUpdatedTimestamp + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);

      const newBalance2 = newBalance.mul(2);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, lender.address, newBalance2, Role.LENDER);

      bucketData.rewardIndex = calculateRewardIndex(
        bucketData.rewardPerToken,
        nextTimestamp2,
        bucketData.lastUpdatedTimestamp,
        bucketData.rewardIndex,
      );
      bucketData.scaledTotalSupply = newBalance2;
      bucketData.rewardPerToken = calculateRewardPerToken(bucketData.rewardPerDay, bucketData.scaledTotalSupply);
      bucketData.lastUpdatedTimestamp = nextTimestamp2;

      lenderInfo.fixedReward = calculateFixedReward(
        lenderInfo.oldBalance,
        bucketData.rewardIndex,
        lenderInfo.lastUpdatedRewardIndex,
        lenderInfo.fixedReward,
      );
      lenderInfo.oldBalance = newBalance2;
      lenderInfo.lastUpdatedRewardIndex = bucketData.rewardIndex;
      //

      // third update
      const nextTimestamp3 = nextTimestamp2 + 12 * SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);
      await network.provider.send("evm_mine");

      const rewardIndex = calculateRewardIndex(
        bucketData.rewardPerToken,
        bucketData.endTimestamp,
        bucketData.lastUpdatedTimestamp,
        bucketData.rewardIndex,
      );
      const reward = calculateFixedReward(lenderInfo.oldBalance, rewardIndex, lenderInfo.lastUpdatedRewardIndex, lenderInfo.fixedReward);
      expect(
        await activityRewardDistributor.getClaimableReward([{ bucketAddress: mockBucket1.address, role: Role.LENDER }], lender.address),
      ).to.equal(reward);
      //
    });
    it("getClaimableReward and claimReward correct calculate array of buckets", async function () {
      await initialSetup(lender.address);

      await activityRewardDistributor.connect(PToken1Signer).updateUserActivity(mockBucket1.address, lender.address, 0, Role.LENDER);

      const fixedReward = (await activityRewardDistributor.getUserInfoFromBucket(mockBucket1.address, Role.LENDER, lender.address))
        .fixedReward;

      // mockBucket2
      const mockDebtToken2 = await deployMockDebtToken(deployer);
      const DebtToken2Signer = await getImpersonateSigner(mockDebtToken2);
      const name2 = "bucket2";
      const mockBucket2 = await deployMockBucket(deployer);
      await mockBucket2.mock.name.returns(name2);
      await mockBucket2.mock.debtToken.returns(mockDebtToken2.address);
      await mockDNS.mock.buckets.withArgs(name2).returns(mockBucket2.address, 1, 0, 0);

      await activityRewardDistributor.setupBucket(mockBucket2.address, Role.TRADER, increaseAmount.mul(2), rewardPerDay.mul(4));

      await activityRewardDistributor
        .connect(DebtToken2Signer)
        .updateUserActivity(mockBucket2.address, lender.address, newBalance, Role.TRADER);

      await activityRewardDistributor.connect(DebtToken2Signer).updateUserActivity(mockBucket2.address, lender.address, 0, Role.TRADER);

      const fixedReward2 = (await activityRewardDistributor.getUserInfoFromBucket(mockBucket2.address, Role.TRADER, lender.address))
        .fixedReward;

      await mockTraderBalanceVault.mock.topUpAvailableBalance.reverts();
      await mockTraderBalanceVault.mock.topUpAvailableBalance
        .withArgs(lender.address, mockPMX.address, fixedReward.add(fixedReward2))
        .returns();

      expect(
        await activityRewardDistributor.getClaimableReward(
          [
            { bucketAddress: mockBucket1.address, role: Role.LENDER },
            { bucketAddress: mockBucket2.address, role: Role.TRADER },
          ],
          lender.address,
        ),
      ).to.equal(fixedReward.add(fixedReward2));

      const tx = await activityRewardDistributor.connect(lender).claimReward([
        { bucketAddress: mockBucket1.address, role: Role.LENDER },
        { bucketAddress: mockBucket2.address, role: Role.TRADER },
      ]);

      await expect(tx)
        .to.emit(activityRewardDistributor, "ClaimReward")
        .withArgs(lender.address, mockBucket1.address, Role.LENDER, fixedReward);

      await expect(tx)
        .to.emit(activityRewardDistributor, "ClaimReward")
        .withArgs(lender.address, mockBucket2.address, Role.TRADER, fixedReward2);
    });
  });
  describe("getBucketAccumulatedReward", function () {
    it("Should return 0 if lastUpdatedRewardTimestamp is 0", async function () {
      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(0);
    });
    it("Should return accumulatedReward", async function () {
      const { bucketData } = await initialSetup(lender.address);

      const nextTimestamp1 = nextTimestamp + ((3 * 24 + 7) * 60 + 53) * 60; // 3 days, 7 hours, 53 minuts
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);
      await network.provider.send("evm_mine");

      const accumulatedReward = rewardPerDay.mul(nextTimestamp1 - bucketData.lastUpdatedRewardTimestamp).div(SECONDS_PER_DAY);
      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(accumulatedReward);

      const nextTimestamp2 = nextTimestamp1 + 10;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);
      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, 0, rewardPerDay.mul(3));
      const fixedReward = rewardPerDay.mul(nextTimestamp2 - bucketData.lastUpdatedRewardTimestamp).div(SECONDS_PER_DAY);

      const nextTimestamp3 = nextTimestamp1 + ((1 * 24 + 2) * 60 + 27) * 60; // 1 day, 2 hours, 27 minuts
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);
      await network.provider.send("evm_mine");

      const accumulatedReward2 = fixedReward.add(
        rewardPerDay
          .mul(3)
          .mul(nextTimestamp3 - nextTimestamp2)
          .div(SECONDS_PER_DAY),
      );
      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(accumulatedReward2);
    });

    it("Should return correct accumulatedReward when rewardPerDay equal zero", async function () {
      const zeroRewardPerDay = 0;
      const { bucketData } = await initialSetup(lender.address);

      const nextTimestamp1 = bucketData.lastUpdatedRewardTimestamp + SECONDS_PER_DAY; // 3 days
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);
      await network.provider.send("evm_mine");

      const expectedAccumulatedReward = rewardPerDay.mul(nextTimestamp1 - bucketData.lastUpdatedRewardTimestamp).div(SECONDS_PER_DAY);
      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(
        expectedAccumulatedReward,
      );

      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, zeroRewardPerDay);

      const timestamp = (await provider.getBlock("latest")).timestamp;
      const nextTimestamp2 = timestamp + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp2]);
      await network.provider.send("evm_mine");

      const fixedReward = expectedAccumulatedReward;
      const ExpectedAccumulatedReward2 = rewardPerDay
        .mul(timestamp - nextTimestamp1)
        .div(SECONDS_PER_DAY)
        .add(fixedReward);
      const accumulatedReward = await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER);
      expect(accumulatedReward).to.equal(ExpectedAccumulatedReward2);

      const nextTimestamp3 = nextTimestamp2 + SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp3]);
      await network.provider.send("evm_mine");

      const fixedReward2 = ExpectedAccumulatedReward2;
      const ExpectedAccumulatedReward3 = BigNumber.from(zeroRewardPerDay)
        .mul(nextTimestamp2 - nextTimestamp3)
        .div(SECONDS_PER_DAY)
        .add(fixedReward2);
      const accumulatedReward2 = await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER);
      expect(accumulatedReward2).to.equal(ExpectedAccumulatedReward3);
    });

    it("Should return bucket.totalReward if accumulatedReward is more then it", async function () {
      const { bucketData } = await initialSetup(lender.address);
      await network.provider.send("evm_setNextBlockTimestamp", [bucketData.endTimestamp.toNumber() + SECONDS_PER_DAY]);
      await network.provider.send("evm_mine");

      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(bucketData.totalReward);
    });

    it("Should return accumulatedReward-bucket.unusedTime", async function () {
      await activityRewardDistributor.setupBucket(mockBucket1.address, Role.LENDER, increaseAmount, rewardPerDay);
      const nextTimestamp1 = nextTimestamp + 12 * SECONDS_PER_DAY;
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp1]);

      await activityRewardDistributor
        .connect(PToken1Signer)
        .updateUserActivity(mockBucket1.address, deployer.address, newBalance, Role.LENDER);

      expect(await activityRewardDistributor.getBucketAccumulatedReward(mockBucket1.address, Role.LENDER)).to.equal(0);
    });
  });
  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, caller.address).returns(false);
      await expect(activityRewardDistributor.connect(caller).pause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(activityRewardDistributor.connect(caller).unpause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
  });
});
