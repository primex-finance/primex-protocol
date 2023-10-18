// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getNamedSigners,
    BigNumber,
    getContractFactory,
    getContract,
    utils: { parseEther },
    constants: { MaxUint256, AddressZero },
    provider,
  },
  deployments: { fixture },
} = require("hardhat");
const { parseArguments } = require("../utils/eventValidation");
const { wadDiv, wadMul } = require("../../test/utils/math");
const { WAD } = require("../utils/bnMath");
process.env.TEST = true;

const { getImpersonateSigner } = require("../utils/hardhatUtils");
const {
  deployMockPrimexDNS,
  deployMockBucket,
  deployMockTraderBalanceVault,
  deployMockPMXToken,
  deployMockAccessControl,
  deployMockTreasury,
  deployMockWhiteBlackList,
} = require("../utils/waffleMocks");

const { SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants");

describe("LiquidityMiningRewardDistributor_unit", function () {
  let deployer, trader, trader2, PrimexDNSSigner;
  let DistributorFactory, LiquidityMiningRewardDistributor;
  let mockPrimexDNS, mockPMX, mockBucket, mockTraderBalanceVault, mockRegistry, mockTreasury, mockWhiteBlackList;
  let pmxRewardAmount, bucketName, bucket;
  let snapshotIdBase;
  let ErrorsLibrary;
  let LMparams, availableLiquidity, maxStabilizationEndTimestamp, tokensLeft, stabilizationDuration;
  before(async function () {
    await fixture(["Errors"]);
    ({ deployer, trader, trader2 } = await getNamedSigners());
    mockPrimexDNS = await deployMockPrimexDNS(deployer);
    mockPMX = await deployMockPMXToken(deployer);
    mockBucket = await deployMockBucket(deployer);
    mockTraderBalanceVault = await deployMockTraderBalanceVault(deployer);
    mockRegistry = await deployMockAccessControl(deployer);
    mockTreasury = await deployMockTreasury(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);

    await mockBucket.mock.isWithdrawAfterDelistingAvailable.returns(false);
    await mockPrimexDNS.mock.registry.returns(AddressZero);
    await mockPrimexDNS.mock.treasury.returns(AddressZero);

    await mockPMX.mock.transfer.returns(true);

    DistributorFactory = await getContractFactory("LiquidityMiningRewardDistributor");
    ErrorsLibrary = await getContract("Errors");
    LiquidityMiningRewardDistributor = await upgrades.deployProxy(
      DistributorFactory,
      [
        mockPrimexDNS.address,
        mockPMX.address,
        mockTraderBalanceVault.address,
        mockRegistry.address,
        mockTreasury.address,
        parseEther("0.01"),
        30 * 24 * 60 * 60,
        mockWhiteBlackList.address,
      ],
      { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
    );
    await mockBucket.mock.getLiquidityMiningParams.returns({
      liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
      isBucketLaunched: false,
      accumulatingAmount: "1230",
      deadlineTimestamp: (Math.floor(new Date().getTime() / 1000) + 604800).toString(), // current timestamp + 1 week,
      stabilizationDuration: "432000", // 5 days,
      stabilizationEndTimestamp: (Math.floor(new Date().getTime() / 1000) + 604800 + 432000).toString(), // current timestamp + 1 week + 5 days,
      maxAmountPerUser: 0,
      maxDuration: "86400", // 1day
      maxStabilizationEndTimestamp: (Math.floor(new Date().getTime() / 1000) + 604800 + 432000).toString(), // current timestamp + 1 week + 5 days
    });
    await mockBucket.mock.availableLiquidity.returns(126);

    LMparams = await mockBucket.getLiquidityMiningParams();
    availableLiquidity = await mockBucket.availableLiquidity();
    maxStabilizationEndTimestamp = BigNumber.from(LMparams.maxStabilizationEndTimestamp);
    tokensLeft = LMparams.isBucketLaunched ? BigNumber.from(0) : BigNumber.from(LMparams.accumulatingAmount).sub(availableLiquidity);
    stabilizationDuration = BigNumber.from(LMparams.stabilizationDuration);

    pmxRewardAmount = parseEther("100");
    PrimexDNSSigner = await getImpersonateSigner(mockPrimexDNS);

    bucketName = "bucket1";
    bucket = await getImpersonateSigner(mockBucket);
    await mockPrimexDNS.mock.getBucketAddress.returns(mockBucket.address);
    await mockPrimexDNS.mock.buckets.returns(mockBucket.address, 1, 0, 0);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("initialize", function () {
    let snapshotId;
    beforeEach(async function () {
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
    it("Should revert deploy LiquidityMiningRewardDistributor if PrimexDNS address does not support IPrimexDNS interface", async function () {
      await mockPrimexDNS.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          DistributorFactory,
          [
            mockPrimexDNS.address,
            mockPMX.address,
            mockTraderBalanceVault.address,
            mockRegistry.address,
            mockTreasury.address,
            parseEther("0.01"),
            30 * 24 * 60 * 60,
            mockWhiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy LiquidityMiningRewardDistributor if TraderBalanceVault address does not support ITraderBalanceVault interface", async function () {
      await mockTraderBalanceVault.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          DistributorFactory,
          [
            mockPrimexDNS.address,
            mockPMX.address,
            mockTraderBalanceVault.address,
            mockRegistry.address,
            mockTreasury.address,
            parseEther("0.01"),
            30 * 24 * 60 * 60,
            mockWhiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy LiquidityMiningRewardDistributor if Registry address does not support IAccessControl interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          DistributorFactory,
          [
            mockPrimexDNS.address,
            mockPMX.address,
            mockTraderBalanceVault.address,
            mockRegistry.address,
            mockTreasury.address,
            parseEther("0.01"),
            30 * 24 * 60 * 60,
            mockWhiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy LiquidityMiningRewardDistributor if Treasury address does not support ITreasury interface", async function () {
      await mockTreasury.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          DistributorFactory,
          [
            mockPrimexDNS.address,
            mockPMX.address,
            mockTraderBalanceVault.address,
            mockRegistry.address,
            mockTreasury.address,
            parseEther("0.01"),
            30 * 24 * 60 * 60,
            mockWhiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy LiquidityMiningRewardDistributor if PMXToken address is not supported", async function () {
      await mockPMX.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          DistributorFactory,
          [
            mockPrimexDNS.address,
            mockPMX.address,
            mockTraderBalanceVault.address,
            mockRegistry.address,
            mockTreasury.address,
            parseEther("0.01"),
            30 * 24 * 60 * 60,
            mockWhiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy LiquidityMiningRewardDistributor if _reinvestmentRate more than WAD", async function () {
      await expect(
        upgrades.deployProxy(
          DistributorFactory,
          [
            mockPrimexDNS.address,
            mockPMX.address,
            mockTraderBalanceVault.address,
            mockRegistry.address,
            mockTreasury.address,
            WAD.add(1),
            30 * 24 * 60 * 60,
            mockWhiteBlackList.address,
          ],
          { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_PERCENT_NUMBER");
    });

    it("Should deploy LiquidityMiningRewardDistributor and set arguments", async function () {
      expect(await LiquidityMiningRewardDistributor.pmx()).to.be.equal(mockPMX.address);
      expect(await LiquidityMiningRewardDistributor.primexDNS()).to.be.equal(mockPrimexDNS.address);
      expect(await LiquidityMiningRewardDistributor.registry()).to.be.equal(mockRegistry.address);
    });
  });

  describe("updateBucketReward and getter getBucketInfo", function () {
    let snapshotId;
    beforeEach(async function () {
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

    it("Should revert updateBucketReward if caller isn't PrimexDNS", async function () {
      await expect(LiquidityMiningRewardDistributor.updateBucketReward(bucketName, pmxRewardAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("getBucketInfo return correct initial value", async function () {
      const expectedBucketInfo = { totalPmxReward: 0, withdrawnRewards: 0, totalPoints: 0 };
      parseArguments(expectedBucketInfo, await LiquidityMiningRewardDistributor.getBucketInfo(bucketName));
    });
    it("updateBucketReward and getTotalPmxRewardForBucket return correct initial value", async function () {
      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketName, pmxRewardAmount);
      const expectedBucketInfo = { totalPmxReward: pmxRewardAmount, withdrawnRewards: 0, totalPoints: 0 };
      parseArguments(expectedBucketInfo, await LiquidityMiningRewardDistributor.getBucketInfo(bucketName));
    });
  });

  async function getRewards(lendersPoints, totalPoints, timestamp, rewardAmount = pmxRewardAmount, extraReward = 0) {
    const period = maxStabilizationEndTimestamp.sub(BigNumber.from(timestamp));
    const maxExpectedPoints = totalPoints.add(
      BigNumber.from(wadDiv(tokensLeft.mul(period).toString(), LMparams.maxDuration.toString()).toString()),
    );
    const minExpectedPoints = totalPoints.add(
      BigNumber.from(wadDiv(tokensLeft.mul(stabilizationDuration).toString(), LMparams.maxDuration.toString()).toString()),
    );

    const minReward = BigNumber.from(lendersPoints).mul(rewardAmount).div(maxExpectedPoints);
    const maxReward = BigNumber.from(lendersPoints).mul(rewardAmount).div(minExpectedPoints);

    return [minReward, maxReward, extraReward];
  }

  async function getExtraReward(lendersPoints, totalPoints, reinvestmentRate, rewardAmount = pmxRewardAmount) {
    // maxStabilizationEndTimestamp means additional points equal 0
    const rewards = await getRewards(lendersPoints, totalPoints, maxStabilizationEndTimestamp, rewardAmount);
    return BigNumber.from(wadMul(rewards[0].toString(), reinvestmentRate.toString()).toString());
  }

  describe("addPoints and getters(getBucketInfo,getLenderAmountInMining,getLenderInfo)", function () {
    let snapshotId;
    let miningAmount;
    beforeEach(async function () {
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

    before(async function () {
      miningAmount = BigNumber.from(100);

      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketName, pmxRewardAmount);
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    it("Should revert addPoints if caller isn't bucket in system", async function () {
      await expect(
        LiquidityMiningRewardDistributor.addPoints(bucketName, deployer.address, miningAmount, 0, 0, 0),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("getLenderInfo should return correct values when totalPoints amount is 0", async function () {
      const expectedLenderInfo = { amountInMining: 0, currentPercent: 0, rewardsInPMX: [0, 0, 0] };
      const timestamp = (await provider.getBlock("latest")).timestamp;
      const result = await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, deployer.address, timestamp);
      parseArguments(expectedLenderInfo, result);
    });

    it("Should addPoints and getters return correct values", async function () {
      const expectedBucketInfo = { totalPmxReward: pmxRewardAmount, withdrawnRewards: 0, totalPoints: BigNumber.from(0) };

      const lendersInfo = [{ lender: deployer.address }, { lender: trader.address }, { lender: trader2.address }];
      for (let i = 0; i < lendersInfo.length; i++) {
        lendersInfo[i].miningAmount = miningAmount.mul(i + 1);
        lendersInfo[i].points = wadDiv(
          lendersInfo[i].miningAmount
            .mul(LMparams.maxStabilizationEndTimestamp.sub((await provider.getBlock("latest")).timestamp))
            .toString(),
          LMparams.maxDuration.toString(),
        ).toString();

        expectedBucketInfo.totalPoints = expectedBucketInfo.totalPoints.add(BigNumber.from(lendersInfo[i].points));
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketName,
          lendersInfo[i].lender,
          lendersInfo[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
      }

      // check getBucketInfo
      parseArguments(expectedBucketInfo, await LiquidityMiningRewardDistributor.getBucketInfo(bucketName));

      for (let i = 0; i < lendersInfo.length; i++) {
        const timestamp = (await provider.getBlock("latest")).timestamp;
        const expectedLenderInfo = {
          amountInMining: lendersInfo[i].miningAmount,
          currentPercent: BigNumber.from(wadDiv(lendersInfo[i].points.toString(), expectedBucketInfo.totalPoints.toString()).toString()),
          rewardsInPMX: await getRewards(lendersInfo[i].points, expectedBucketInfo.totalPoints, timestamp),
        };

        // check getLenderAmountInMining
        expect(lendersInfo[i].miningAmount).to.equal(
          await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketName, lendersInfo[i].lender),
        );
        // check getLenderInfo

        parseArguments(
          expectedLenderInfo,
          await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, lendersInfo[i].lender, timestamp),
        );
      }
    });
  });
  describe("reinvest and getters(getBucketInfo,getLenderAmountInMining,getLenderInfo)", function () {
    let snapshotId;
    let miningAmount, liquidityMinindDeadline, reinvestmentRate, pmxRewardAmount1;
    let bucketTo1, expectedBucketInfo, lendersInfo;
    let bucketTo2, expectedBucketInfo1, lendersInfo1;
    beforeEach(async function () {
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

    before(async function () {
      bucketTo1 = "bucket2";
      bucketTo2 = "bucket3";

      miningAmount = BigNumber.from(100);
      liquidityMinindDeadline = MaxUint256.div(2);
      reinvestmentRate = await LiquidityMiningRewardDistributor.reinvestmentRate();
      pmxRewardAmount1 = pmxRewardAmount.mul(2);
      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketName, pmxRewardAmount);
      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketTo1, pmxRewardAmount1);

      expectedBucketInfo = { totalPmxReward: pmxRewardAmount, withdrawnRewards: 0, totalPoints: BigNumber.from(0) };
      lendersInfo = [{ lender: deployer.address }, { lender: trader.address }, { lender: trader2.address }];
      for (let i = 0; i < lendersInfo.length; i++) {
        lendersInfo[i].miningAmount = miningAmount.mul(i + 1);
        lendersInfo[i].points = wadDiv(
          lendersInfo[i].miningAmount
            .mul(LMparams.maxStabilizationEndTimestamp.sub((await provider.getBlock("latest")).timestamp))
            .toString(),
          LMparams.maxDuration.toString(),
        ).toString();

        expectedBucketInfo.totalPoints = expectedBucketInfo.totalPoints.add(lendersInfo[i].points);
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketName,
          lendersInfo[i].lender,
          lendersInfo[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
      }

      expectedBucketInfo1 = { totalPmxReward: pmxRewardAmount1, withdrawnRewards: 0, totalPoints: BigNumber.from(0) };
      lendersInfo1 = [{ lender: deployer.address }, { lender: trader.address }, { lender: trader2.address }];
      for (let i = 0; i < lendersInfo1.length; i++) {
        lendersInfo1[i].miningAmount = miningAmount.mul(i + 1);
        lendersInfo1[i].points = wadDiv(
          lendersInfo1[i].miningAmount
            .mul(LMparams.maxStabilizationEndTimestamp.sub((await provider.getBlock("latest")).timestamp))
            .toString(),
          LMparams.maxDuration.toString(),
        ).toString();

        expectedBucketInfo1.totalPoints = expectedBucketInfo1.totalPoints.add(lendersInfo1[i].points);
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketTo1,
          lendersInfo1[i].lender,
          lendersInfo1[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
      }
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    it("Should revert reinvest if caller isn't bucket in system", async function () {
      await expect(
        LiquidityMiningRewardDistributor.reinvest(bucketName, bucketTo1, deployer.address, false, 0),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert reinvest when contract is paused", async function () {
      await LiquidityMiningRewardDistributor.pause();
      const timestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await expect(
        LiquidityMiningRewardDistributor.connect(bucket).reinvest(bucketName, bucketTo2, deployer.address, true, timestamp),
      ).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert reinvest if reinvestment deadline is passed", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      const passedDeadline = BigNumber.from(timestamp)
        .sub(await LiquidityMiningRewardDistributor.reinvestmentDuration())
        .sub(100);
      await expect(
        LiquidityMiningRewardDistributor.connect(bucket).reinvest(bucketName, bucketTo1, deployer.address, false, passedDeadline),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEADLINE_IS_PASSED");
    });
    it("getLenderInfo should return correct values when liquidity mining in bucket is failed", async function () {
      for (const lenderObject of lendersInfo) {
        const extraReward = await getExtraReward(lenderObject.points, expectedBucketInfo.totalPoints, reinvestmentRate);
        const expectedLenderInfo = {
          amountInMining: lenderObject.miningAmount,
          currentPercent: BigNumber.from(wadDiv(lenderObject.points.toString(), expectedBucketInfo.totalPoints.toString()).toString()),
          rewardsInPMX: [extraReward, extraReward, 0],
        };
        const timestamp = MaxUint256;
        parseArguments(
          expectedLenderInfo,
          await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, lenderObject.lender, timestamp),
        );
      }
    });
    it("Should correct update state if bucketTo2 is launched and emit ClaimedReward event", async function () {
      const extraReward = await getExtraReward(lendersInfo[0].points, expectedBucketInfo.totalPoints, reinvestmentRate);
      await LiquidityMiningRewardDistributor.connect(bucket).reinvest(
        bucketName,
        bucketTo1,
        deployer.address,
        false,
        liquidityMinindDeadline,
      );

      const extraReward2 = await getExtraReward(
        lendersInfo1[0].points,
        expectedBucketInfo1.totalPoints,
        reinvestmentRate,
        pmxRewardAmount1,
      );
      await mockTraderBalanceVault.mock.topUpAvailableBalance.returns();

      await expect(
        LiquidityMiningRewardDistributor.connect(bucket).reinvest(bucketTo1, bucketTo2, deployer.address, true, liquidityMinindDeadline),
      )
        .to.emit(LiquidityMiningRewardDistributor, "ClaimedReward")
        .withArgs(deployer.address, mockBucket.address, extraReward.add(extraReward2));

      // check getLenderAmountInMining
      expect(0).to.equal(await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketTo1, deployer.address));

      // check getBucketInfo
      parseArguments(
        { ...expectedBucketInfo1, withdrawnRewards: extraReward2 },
        await LiquidityMiningRewardDistributor.getBucketInfo(bucketTo1),
      );

      // check getLenderInfo
      parseArguments([0, 0, [0, 0, 0]], await LiquidityMiningRewardDistributor.getLenderInfo(bucketTo1, deployer.address, 0));
    });

    it("Should correct update state if bucketTo1 and bucketTo2 aren't launched", async function () {
      const extraReward = await getExtraReward(lendersInfo[0].points, expectedBucketInfo.totalPoints, reinvestmentRate);
      await LiquidityMiningRewardDistributor.connect(bucket).reinvest(
        bucketName,
        bucketTo1,
        deployer.address,
        false,
        liquidityMinindDeadline,
      );
      // check getLenderAmountInMining
      expect(0).to.equal(await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketName, deployer.address));

      // check getBucketInfo

      parseArguments(
        { ...expectedBucketInfo, withdrawnRewards: extraReward },
        await LiquidityMiningRewardDistributor.getBucketInfo(bucketName),
      );

      // check getLenderInfo
      parseArguments([0, 0, [0, 0, 0]], await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, deployer.address, 0));

      const expectedLenderInfo = {
        amountInMining: lendersInfo1[0].miningAmount,
        currentPercent: BigNumber.from(wadDiv(lendersInfo1[0].points.toString(), expectedBucketInfo1.totalPoints.toString()).toString()),
        rewardsInPMX: await getRewards(lendersInfo1[0].points, expectedBucketInfo1.totalPoints, 0, pmxRewardAmount1, extraReward),
      };
      parseArguments(expectedLenderInfo, await LiquidityMiningRewardDistributor.getLenderInfo(bucketTo1, deployer.address, 0));

      // second reinvest
      const extraReward2 = await getExtraReward(
        lendersInfo1[0].points,
        expectedBucketInfo1.totalPoints,
        reinvestmentRate,
        pmxRewardAmount1,
      );
      await LiquidityMiningRewardDistributor.connect(bucket).reinvest(
        bucketTo1,
        bucketTo2,
        deployer.address,
        false,
        liquidityMinindDeadline,
      );

      // check getLenderAmountInMining
      expect(0).to.equal(await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketTo1, deployer.address));

      // check getBucketInfo
      parseArguments(
        { ...expectedBucketInfo1, withdrawnRewards: extraReward2 },
        await LiquidityMiningRewardDistributor.getBucketInfo(bucketTo1),
      );

      // check getLenderInfo
      parseArguments([0, 0, [0, 0, 0]], await LiquidityMiningRewardDistributor.getLenderInfo(bucketTo1, deployer.address, 0));

      parseArguments(
        [0, 0, [0, 0, extraReward.add(extraReward2)]],
        await LiquidityMiningRewardDistributor.getLenderInfo(bucketTo2, deployer.address, 0),
      );
    });
  });
  describe("removePoints and getters(getBucketInfo,getLenderAmountInMining,getLenderInfo)", function () {
    let snapshotId;
    let expectedBucketInfo, lendersInfo, expectedBucketInfo1, lendersInfo1, bucketTo1;
    beforeEach(async function () {
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

    before(async function () {
      const miningAmount = BigNumber.from(100);
      bucketTo1 = "bucketTo1";

      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketName, pmxRewardAmount);
      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketTo1, pmxRewardAmount);

      expectedBucketInfo = { totalPmxReward: pmxRewardAmount, withdrawnRewards: 0, totalPoints: BigNumber.from(0) };
      lendersInfo = [{ lender: deployer.address }, { lender: trader.address }, { lender: trader2.address }];

      expectedBucketInfo1 = { totalPmxReward: pmxRewardAmount, withdrawnRewards: 0, totalPoints: BigNumber.from(0) };
      lendersInfo1 = [{ lender: deployer.address }, { lender: trader.address }, { lender: trader2.address }];

      for (let i = 0; i < lendersInfo.length; i++) {
        lendersInfo[i].miningAmount = miningAmount.mul(i + 1);
        lendersInfo[i].points = wadDiv(
          lendersInfo[i].miningAmount
            .mul(LMparams.maxStabilizationEndTimestamp.sub((await provider.getBlock("latest")).timestamp))
            .toString(),
          LMparams.maxDuration.toString(),
        ).toString();

        expectedBucketInfo.totalPoints = expectedBucketInfo.totalPoints.add(lendersInfo[i].points);
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketName,
          lendersInfo[i].lender,
          lendersInfo[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );

        lendersInfo1[i].miningAmount = miningAmount.mul(i + 1);
        lendersInfo1[i].points = wadDiv(
          lendersInfo1[i].miningAmount
            .mul(LMparams.maxStabilizationEndTimestamp.sub((await provider.getBlock("latest")).timestamp))
            .toString(),
          LMparams.maxDuration.toString(),
        ).toString();

        expectedBucketInfo1.totalPoints = expectedBucketInfo1.totalPoints.add(lendersInfo1[i].points);
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketTo1,
          lendersInfo1[i].lender,
          lendersInfo1[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
      }
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    it("Should revert removePoints if caller isn't bucket in system", async function () {
      await expect(LiquidityMiningRewardDistributor.removePoints(bucketName, deployer.address, 0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert removePoints if _amount is more than amount in LM", async function () {
      await expect(
        LiquidityMiningRewardDistributor.connect(bucket).removePoints(bucketName, deployer.address, MaxUint256.sub(1)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ATTEMPT_TO_WITHDRAW_MORE_THAN_DEPOSITED");
    });

    it("removePoints should remove part of extra reward", async function () {
      const reinvestmentRate = await LiquidityMiningRewardDistributor.reinvestmentRate();
      const liquidityMinindDeadline = MaxUint256.div(2);

      const extraReward = await getExtraReward(lendersInfo[0].points, expectedBucketInfo.totalPoints, reinvestmentRate);
      await LiquidityMiningRewardDistributor.connect(bucket).reinvest(
        bucketName,
        bucketTo1,
        lendersInfo[0].lender,
        false,
        liquidityMinindDeadline,
      );
      const timestamp = (await provider.getBlock("latest")).timestamp;
      const rewardsInPMX = await getRewards(lendersInfo1[0].points, expectedBucketInfo1.totalPoints, timestamp);
      rewardsInPMX[2] = extraReward;

      const expectedLenderInfo = {
        amountInMining: lendersInfo1[0].miningAmount,
        currentPercent: BigNumber.from(wadDiv(lendersInfo1[0].points.toString(), expectedBucketInfo1.totalPoints.toString()).toString()),
        rewardsInPMX: rewardsInPMX,
      };

      parseArguments(
        expectedLenderInfo,
        await LiquidityMiningRewardDistributor.getLenderInfo(bucketTo1, lendersInfo1[0].lender, timestamp),
      );

      const removedAmount = lendersInfo1[0].miningAmount.div(4);
      const multiplier = wadDiv(removedAmount.toString(), lendersInfo1[0].miningAmount.toString()).toString();
      const removedPoints = wadMul(lendersInfo1[0].points, multiplier).toString();

      const totalPointsAfterRemove = expectedBucketInfo1.totalPoints.sub(removedPoints);
      const lendersPointsAfterRemove = BigNumber.from(lendersInfo1[0].points).sub(removedPoints);

      expectedLenderInfo.amountInMining = lendersInfo1[0].miningAmount.sub(removedAmount);
      expectedLenderInfo.currentPercent = BigNumber.from(
        wadDiv(lendersPointsAfterRemove.toString(), totalPointsAfterRemove.toString()).toString(),
      );
      expectedLenderInfo.rewardsInPMX = await getRewards(lendersPointsAfterRemove, totalPointsAfterRemove, timestamp);
      expectedLenderInfo.rewardsInPMX[2] = extraReward.sub(wadMul(extraReward.toString(), multiplier).toString());

      await LiquidityMiningRewardDistributor.connect(bucket).removePoints(bucketTo1, lendersInfo1[0].lender, removedAmount);
      parseArguments(
        expectedLenderInfo,
        await LiquidityMiningRewardDistributor.getLenderInfo(bucketTo1, lendersInfo1[0].lender, timestamp),
      );
    });

    it("Should removePoints and getters return correct values", async function () {
      const removedAmount = lendersInfo[0].miningAmount.div(4);
      const multiplier = wadDiv(removedAmount.toString(), lendersInfo[0].miningAmount.toString()).toString();
      const removedPoints = wadMul(lendersInfo[0].points, multiplier).toString();
      await LiquidityMiningRewardDistributor.connect(bucket).removePoints(bucketName, lendersInfo[0].lender, removedAmount);

      expectedBucketInfo.totalPoints = expectedBucketInfo.totalPoints.sub(removedPoints);
      lendersInfo[0].points = BigNumber.from(lendersInfo[0].points).sub(removedPoints);
      lendersInfo[0].miningAmount = lendersInfo[0].miningAmount.sub(removedAmount);

      // check getBucketInfo
      parseArguments(expectedBucketInfo, await LiquidityMiningRewardDistributor.getBucketInfo(bucketName));

      for (let i = 0; i < lendersInfo.length; i++) {
        const timestamp = (await provider.getBlock("latest")).timestamp;
        const expectedLenderInfo = {
          amountInMining: lendersInfo[i].miningAmount,
          currentPercent: BigNumber.from(wadDiv(lendersInfo[i].points.toString(), expectedBucketInfo.totalPoints.toString()).toString()),
          rewardsInPMX: await getRewards(lendersInfo[i].points, expectedBucketInfo.totalPoints, timestamp),
        };
        // check getLenderAmountInMining
        expect(lendersInfo[i].miningAmount).to.equal(
          await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketName, lendersInfo[i].lender),
        );
        // check getLenderInfo

        parseArguments(
          expectedLenderInfo,
          await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, lendersInfo[i].lender, timestamp),
        );
      }
    });

    it("Should correct removePoints when _amount is MaxUint256", async function () {
      await LiquidityMiningRewardDistributor.connect(bucket).removePoints(bucketName, lendersInfo[0].lender, MaxUint256);

      expectedBucketInfo.totalPoints = expectedBucketInfo.totalPoints.sub(lendersInfo[0].points);
      lendersInfo[0].points = BigNumber.from(0);
      lendersInfo[0].miningAmount = BigNumber.from(0);

      // check getBucketInfo
      parseArguments(expectedBucketInfo, await LiquidityMiningRewardDistributor.getBucketInfo(bucketName));

      for (let i = 0; i < lendersInfo.length; i++) {
        const timestamp = (await provider.getBlock("latest")).timestamp;
        const expectedLenderInfo = {
          amountInMining: lendersInfo[i].miningAmount,
          currentPercent: BigNumber.from(wadDiv(lendersInfo[i].points.toString(), expectedBucketInfo.totalPoints.toString()).toString()),
          rewardsInPMX: await getRewards(lendersInfo[i].points, expectedBucketInfo.totalPoints, timestamp),
        };
        // check getLenderAmountInMining
        expect(lendersInfo[i].miningAmount).to.equal(
          await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketName, lendersInfo[i].lender),
        );
        // check getLenderInfo

        parseArguments(
          expectedLenderInfo,
          await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, lendersInfo[i].lender, timestamp),
        );
      }
    });
  });

  describe("claimReward and getters(getBucketInfo,getLenderAmountInMining,getLenderInfo)", function () {
    let snapshotId;
    let lendersInfo, expectedBucketInfo;
    beforeEach(async function () {
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

    before(async function () {
      const miningAmount = BigNumber.from(100);

      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketName, pmxRewardAmount);
      expectedBucketInfo = { totalPmxReward: pmxRewardAmount, withdrawnRewards: BigNumber.from(0), totalPoints: BigNumber.from(0) };

      lendersInfo = [{ lender: deployer }, { lender: trader }, { lender: trader2 }];
      for (let i = 0; i < lendersInfo.length; i++) {
        lendersInfo[i].miningAmount = miningAmount.mul(i + 1);
        lendersInfo[i].points = wadDiv(
          lendersInfo[i].miningAmount
            .mul(LMparams.maxStabilizationEndTimestamp.sub((await provider.getBlock("latest")).timestamp))
            .toString(),
          LMparams.maxDuration.toString(),
        ).toString();

        expectedBucketInfo.totalPoints = expectedBucketInfo.totalPoints.add(lendersInfo[i].points);
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketName,
          lendersInfo[i].lender.address,
          lendersInfo[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
      }
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    it("Should revert claimReward when bucket isBucketStable is false", async function () {
      await mockBucket.mock.isBucketStable.returns(false);

      await expect(LiquidityMiningRewardDistributor.claimReward(bucketName)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_NOT_STABLE",
      );
    });
    it("Should revert claimReward if LiquidityMiningRewardDistributor is paused", async function () {
      await LiquidityMiningRewardDistributor.pause();
      await mockBucket.mock.isBucketStable.returns(true);
      await mockTraderBalanceVault.mock.topUpAvailableBalance.returns();
      await expect(LiquidityMiningRewardDistributor.claimReward(bucketName)).to.be.revertedWith("Pausable: paused");
    });
    it("Should claimReward and getters return correct values", async function () {
      await mockBucket.mock.isBucketStable.returns(true);
      await mockTraderBalanceVault.mock.topUpAvailableBalance.returns();

      for (let i = 0; i < lendersInfo.length; i++) {
        await LiquidityMiningRewardDistributor.connect(lendersInfo[i].lender).claimReward(bucketName);
        expectedBucketInfo.withdrawnRewards = expectedBucketInfo.withdrawnRewards.add(
          pmxRewardAmount.mul(lendersInfo[i].points).div(expectedBucketInfo.totalPoints),
        );
        const expectedLenderInfo = {
          amountInMining: 0,
          currentPercent: 0,
          rewardsInPMX: [0, 0, 0],
        };
        // check getLenderAmountInMining
        expect(0).to.equal(await LiquidityMiningRewardDistributor.getLenderAmountInMining(bucketName, lendersInfo[i].lender.address));
        // check getLenderInfo
        const timestamp = (await provider.getBlock("latest")).timestamp;
        parseArguments(
          expectedLenderInfo,
          await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, lendersInfo[i].lender.address, timestamp),
        );
        // check getBucketInfo
        parseArguments(expectedBucketInfo, await LiquidityMiningRewardDistributor.getBucketInfo(bucketName));
      }
    });
    it("Should emit ClaimedReward event if claimReward is successful", async function () {
      await mockBucket.mock.isBucketStable.returns(true);
      await mockTraderBalanceVault.mock.topUpAvailableBalance.returns();

      await mockBucket.mock.getLiquidityMiningParams.returns({
        liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
        isBucketLaunched: true,
        accumulatingAmount: "1230",
        deadlineTimestamp: (Math.floor(new Date().getTime() / 1000) + 604800).toString(), // current timestamp + 1 week,
        stabilizationDuration: "432000", // 5 days,
        stabilizationEndTimestamp: (Math.floor(new Date().getTime() / 1000) + 604800 + 432000).toString(), // current timestamp + 1 week + 5 days,
        maxAmountPerUser: 0,
        maxDuration: "86400", // 1day
        maxStabilizationEndTimestamp: (Math.floor(new Date().getTime() / 1000) + 604800 + 432000).toString(), // current timestamp + 1 week + 5 days
      });
      const LMparamsCurrent = await mockBucket.getLiquidityMiningParams();
      const timestamp = LMparamsCurrent.stabilizationEndTimestamp.toNumber() + 1;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
      await network.provider.send("evm_mine");

      for (let i = 0; i < lendersInfo.length; i++) {
        const { rewardsInPMX } = await LiquidityMiningRewardDistributor.getLenderInfo(bucketName, lendersInfo[i].lender.address, timestamp);

        const claimReward = LiquidityMiningRewardDistributor.connect(lendersInfo[i].lender).claimReward(bucketName);
        await expect(claimReward)
          .to.emit(LiquidityMiningRewardDistributor, "ClaimedReward")
          .withArgs(lendersInfo[i].lender.address, mockBucket.address, rewardsInPMX.minReward);
      }
    });
  });

  describe("withdrawFromDelistedBucket", function () {
    let lendersInfo;

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      const addedPoints = BigNumber.from(100);
      const miningAmount = BigNumber.from(100);

      await LiquidityMiningRewardDistributor.connect(PrimexDNSSigner).updateBucketReward(bucketName, pmxRewardAmount);

      lendersInfo = [{ lender: deployer.address }, { lender: trader.address }, { lender: trader2.address }];
      for (let i = 0; i < lendersInfo.length; i++) {
        lendersInfo[i].points = addedPoints.mul(i + 1);
        lendersInfo[i].miningAmount = miningAmount.mul(i + 1);
        await LiquidityMiningRewardDistributor.connect(bucket).addPoints(
          bucketName,
          lendersInfo[i].lender,
          lendersInfo[i].miningAmount,
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );
      }
    });
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    it("Should revert withdrawPmxByAdmin if caller isn't MEDIUM_TIMELOCK_ADMIN", async function () {
      await mockRegistry.mock.hasRole.returns(false);
      await expect(LiquidityMiningRewardDistributor.withdrawPmxByAdmin(bucketName)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, trader.address).returns(false);
      await expect(LiquidityMiningRewardDistributor.connect(trader).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, trader.address).returns(false);
      await expect(LiquidityMiningRewardDistributor.connect(trader).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
