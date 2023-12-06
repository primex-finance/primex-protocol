const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getNamedSigners,
    getContract,
    getContractAt,
    utils: { parseEther, parseUnits },
    provider,
    constants: { MaxUint256 },
  },
  deployments: { fixture },
} = require("hardhat");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const { barCalcParams } = require("../utils/defaultBarCalcParams");

process.env.TEST = true;

describe("LiquidityMiningRewardDistributor_integration", function () {
  let lender;
  let LiquidityMiningRewardDistributor, treasury, errorsLibrary, pmx, PrimexDNS;
  let nameBucket, bucket;
  let snapshotId;
  let LMparams;
  let testTokenA, decimalsA;
  let testTokenB;
  before(async function () {
    await fixture(["Test"]);
    ({ lender } = await getNamedSigners());
    const currentTimestamp = (await provider.getBlock("latest")).timestamp;
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    LiquidityMiningRewardDistributor = await getContract("LiquidityMiningRewardDistributor");
    treasury = await getContract("Treasury");
    pmx = await getContract("EPMXToken");
    errorsLibrary = await getContract("Errors");
    PrimexDNS = await getContract("PrimexDNS");

    nameBucket = "BucketWithLiquidityMining";
    const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
      nameBucket: nameBucket,
      assets: `["${testTokenB.address}"]`,
      pairPriceDrops: "[\"100000000000000000\"]",
      feeBuffer: "1000100000000000000", // 1.0001
      withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
      reserveRate: "100000000000000000", // 0.1 - 10%,
      underlyingAsset: testTokenA.address,
      liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
      liquidityMiningAmount: parseUnits("100", decimalsA).toString(),
      liquidityMiningDeadline: (currentTimestamp + 24 * 60 * 60).toFixed(), // currentTimestamp + 1 day
      stabilizationDuration: (60 * 60).toFixed(), // 1 hour
      pmxRewardAmount: parseEther("2000").toString(),
      estimatedBar: "100000000000000000000000000", // 0.1 in ray
      estimatedLar: "70000000000000000000000000", // 0.07 in ray
      maxAmountPerUser: MaxUint256.toString(),
      barCalcParams: JSON.stringify(barCalcParams),
      maxTotalDeposit: MaxUint256.toString(),
    });
    bucket = await getContractAt("Bucket", newBucketAddress);
    LMparams = await bucket.getLiquidityMiningParams();
  });
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

  it("Should set minReward = maxReward if liquidityMiningDeadline is reached and the bucket is launched", async function () {
    await testTokenA.connect(lender).approve(bucket.address, LMparams.accumulatingAmount);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, LMparams.accumulatingAmount, true);

    let timestamp = LMparams.deadlineTimestamp;
    timestamp = timestamp.toNumber() + 1;
    await network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await network.provider.send("evm_mine");

    const { isBucketLaunched } = await bucket.getLiquidityMiningParams();
    expect(isBucketLaunched).to.equal(true);

    const result = await LiquidityMiningRewardDistributor.getLenderInfo(nameBucket, lender.address, timestamp);
    expect(result.rewardsInPMX.minReward).to.equal(result.rewardsInPMX.maxReward);
    expect(result.rewardsInPMX.minReward).to.be.gt(0);
  });

  it("Should not launch the bucket if availableLiquidity > liquidityMiningAmount (top-up bucket via transfer) and liquidityMiningDeadline is not reached", async function () {
    await testTokenA.connect(lender).approve(bucket.address, LMparams.accumulatingAmount);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, LMparams.accumulatingAmount.div(2), true);
    await testTokenA.connect(lender).transfer(bucket.address, LMparams.accumulatingAmount);

    const newLMparams = await bucket.getLiquidityMiningParams();
    expect(newLMparams.isBucketLaunched).to.equal(false);

    const timestamp = (await provider.getBlock("latest")).timestamp;
    expect(newLMparams.deadlineTimestamp).to.be.gt(timestamp);
  });

  it("Should not change lender info if the lender added liquidity to the bucket via transfer", async function () {
    await testTokenA.connect(lender).approve(bucket.address, LMparams.accumulatingAmount);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, LMparams.accumulatingAmount.div(2), true);

    let timestamp = (await provider.getBlock("latest")).timestamp;
    const result1 = await LiquidityMiningRewardDistributor.getLenderInfo(nameBucket, lender.address, timestamp);

    await testTokenA.connect(lender).transfer(bucket.address, LMparams.accumulatingAmount.div(3));

    timestamp = (await provider.getBlock("latest")).timestamp;
    const result2 = await LiquidityMiningRewardDistributor.getLenderInfo(nameBucket, lender.address, timestamp);

    expect(result1.amountInMining).to.be.equal(result2.amountInMining);
    expect(result1.currentPercent).to.be.equal(result2.currentPercent);
  });

  describe("withdrawPmxByAdmin", function () {
    describe("bucket with liquidity mining", function () {
      let reinvestmentDuration, timestampAfterReinvestmentPeriod;
      before(async function () {
        reinvestmentDuration = await LiquidityMiningRewardDistributor.reinvestmentDuration();
        timestampAfterReinvestmentPeriod = LMparams.deadlineTimestamp.add(reinvestmentDuration).add(1);
      });
      it("Should revert if reinvestment period is not over", async function () {
        const isWithdrawAfterDelistingAvailable = await bucket.isWithdrawAfterDelistingAvailable();
        await expect(isWithdrawAfterDelistingAvailable).to.be.equal(false);
        const timestamp = (await provider.getBlock("latest")).timestamp;
        await expect(LMparams.deadlineTimestamp).to.be.gt(timestamp);
        await expect(LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket)).to.be.revertedWithCustomError(
          errorsLibrary,
          "WITHDRAW_PMX_BY_ADMIN_FORBIDDEN",
        );
      });

      it("Should revert if reinvestment period is over but the bucket is launched", async function () {
        await testTokenA.connect(lender).approve(bucket.address, LMparams.accumulatingAmount);
        await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, LMparams.accumulatingAmount, true);

        await network.provider.send("evm_setNextBlockTimestamp", [timestampAfterReinvestmentPeriod.toNumber()]);
        await network.provider.send("evm_mine");
        const timestamp = (await provider.getBlock("latest")).timestamp;

        await expect(LMparams.deadlineTimestamp.add(reinvestmentDuration)).to.be.lt(timestamp);
        const { isBucketLaunched } = await bucket.getLiquidityMiningParams();
        expect(isBucketLaunched).to.equal(true);

        const isWithdrawAfterDelistingAvailable = await bucket.isWithdrawAfterDelistingAvailable();
        await expect(isWithdrawAfterDelistingAvailable).to.be.equal(false);
        await expect(LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket)).to.be.revertedWithCustomError(
          errorsLibrary,
          "WITHDRAW_PMX_BY_ADMIN_FORBIDDEN",
        );
      });

      it("Should emit WithdrawPmxByAdmin when transfer to treasury is successful", async function () {
        await network.provider.send("evm_setNextBlockTimestamp", [timestampAfterReinvestmentPeriod.toNumber()]);
        await network.provider.send("evm_mine");
        const { totalPmxReward } = await LiquidityMiningRewardDistributor.getBucketInfo(nameBucket);
        await expect(LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket))
          .to.emit(LiquidityMiningRewardDistributor, "WithdrawPmxByAdmin")
          .withArgs(totalPmxReward);
      });

      it("Should update withdrawnRewards when transfer to treasury is successful", async function () {
        await network.provider.send("evm_setNextBlockTimestamp", [timestampAfterReinvestmentPeriod.toNumber()]);
        await network.provider.send("evm_mine");
        await LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket);
        const { totalPmxReward, withdrawnRewards } = await LiquidityMiningRewardDistributor.getBucketInfo(nameBucket);
        expect(totalPmxReward).to.be.equal(withdrawnRewards);
      });

      it("Should revert if amount to transfer to treasury is zero", async function () {
        await network.provider.send("evm_setNextBlockTimestamp", [timestampAfterReinvestmentPeriod.toNumber()]);
        await network.provider.send("evm_mine");
        const dnsSigner = await getImpersonateSigner(PrimexDNS);
        await LiquidityMiningRewardDistributor.connect(dnsSigner).updateBucketReward(nameBucket, 0);
        const { totalPmxReward } = await LiquidityMiningRewardDistributor.getBucketInfo(nameBucket);

        expect(totalPmxReward).to.be.equal(0);
        await expect(LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket)).to.be.revertedWithCustomError(
          errorsLibrary,
          "ZERO_AMOUNT",
        );
      });

      it("Should revert if caller is not granted with MEDIUM_TIMELOCK_ADMIN", async function () {
        await expect(LiquidityMiningRewardDistributor.connect(lender).withdrawPmxByAdmin(nameBucket)).to.be.revertedWithCustomError(
          errorsLibrary,
          "FORBIDDEN",
        );
      });

      it("Should transfer to treasury totalPmxReward without withdrawnRewards", async function () {
        const bucketSigner = await getImpersonateSigner(bucket);

        await LiquidityMiningRewardDistributor.connect(bucketSigner).addPoints(
          nameBucket,
          lender.address,
          LMparams.accumulatingAmount.div(3),
          LMparams.maxStabilizationEndTimestamp,
          LMparams.maxDuration,
          (
            await provider.getBlock("latest")
          ).timestamp,
        );

        await LiquidityMiningRewardDistributor.connect(bucketSigner).reinvest(
          nameBucket,
          "bucket1",
          lender.address,
          false,
          LMparams.deadlineTimestamp,
        );

        await network.provider.send("evm_setNextBlockTimestamp", [timestampAfterReinvestmentPeriod.toNumber()]);
        await network.provider.send("evm_mine");

        const { totalPmxReward, withdrawnRewards } = await LiquidityMiningRewardDistributor.getBucketInfo(nameBucket);
        const amountToTreasury = totalPmxReward.sub(withdrawnRewards);

        await expect(() => LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket)).to.changeTokenBalance(
          pmx,
          treasury,
          amountToTreasury,
        );
      });
    });
    describe("delisted bucket", function () {
      it("Should emit WithdrawPmxByAdmin when transfer to treasury is successful", async function () {
        await testTokenA.connect(lender).approve(bucket.address, LMparams.accumulatingAmount);
        await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, LMparams.accumulatingAmount, true);

        await PrimexDNS.deprecateBucket(nameBucket);
        await network.provider.send("evm_increaseTime", [
          (
            await PrimexDNS.delistingDelay()
          )
            .add(await PrimexDNS.adminWithdrawalDelay())
            .add("1")
            .toNumber(),
        ]);
        await network.provider.send("evm_mine");
        const isWithdrawAfterDelistingAvailable = await bucket.isWithdrawAfterDelistingAvailable();
        await expect(isWithdrawAfterDelistingAvailable).to.be.equal(true);

        const { totalPmxReward } = await LiquidityMiningRewardDistributor.getBucketInfo(nameBucket);
        await expect(LiquidityMiningRewardDistributor.withdrawPmxByAdmin(nameBucket))
          .to.emit(LiquidityMiningRewardDistributor, "WithdrawPmxByAdmin")
          .withArgs(totalPmxReward);
      });
    });
  });
});
