// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseUnits, keccak256, parseEther, toUtf8Bytes },
    constants: { MaxUint256, NegativeOne, AddressZero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { addLiquidity, checkIsDexSupported } = require("../utils/dexOperations");
const { getEncodedChainlinkRouteViaUsd } = require("../utils/oracleUtils");
const { deployMockERC20, deployMockBucket } = require("../utils/waffleMocks");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const { setupUsdOraclesForTokens, getExchangeRateByRoutes } = require("../utils/oracleUtils");
const { parseArguments, eventValidation } = require("../utils/eventValidation");
const { rayDiv, wadMul } = require("../utils/math");

const { barCalcParams } = require("../utils/defaultBarCalcParams");
const { SECONDS_PER_DAY } = require("../../Constants.js");
const { USD_DECIMALS, WAD } = require("../utils/constants");

process.env.TEST = true;

describe("DepositManager_integration", function () {
  let snapshotId;
  let DepositManager, PrimexDNS, Treasury, WhiteBlackList, ErrorsLibrary;
  let deployer, lender, trader, mockContract, lenderAmount;
  let dex, testTokenA, testTokenB, decimalsA, decimalsB, pToken, pTokenAddress;
  let bucketAddress, bucket, bucket2, depositAmount;
  let rewardParameters;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, lender, trader } = await getNamedSigners());
    Treasury = await getContract("Treasury");
    DepositManager = await getContract("DepositManager");
    PrimexDNS = await getContract("PrimexDNS");
    WhiteBlackList = await getContract("WhiteBlackList");
    ErrorsLibrary = await getContract("Errors");
    const registry = await getContract("Registry");

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenA.decimals();

    await testTokenB.mint(DepositManager.address, parseUnits("500", decimalsB));
    await testTokenA.mint(trader.address, parseUnits("500", decimalsA));
    const price = parseUnits("5", USD_DECIMALS);
    await setupUsdOraclesForTokens(testTokenA, testTokenB, price);

    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    lenderAmount = parseUnits("100", decimalsA);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    pTokenAddress = await bucket.pToken();
    pToken = await getContractAt("PToken", pTokenAddress);
    depositAmount = parseUnits("10", decimalsA);
    await pToken.connect(lender).approve(DepositManager.address, depositAmount);
    await testTokenA.connect(lender).approve(DepositManager.address, depositAmount.mul(4));
    await testTokenA.connect(trader).approve(DepositManager.address, depositAmount.mul(4));

    const NFT_MINTER = keccak256(toUtf8Bytes("NFT_MINTER"));

    await registry.grantRole(NFT_MINTER, deployer.address);

    const bucketName2 = "bucket2";
    const assets = `["${testTokenB.address}"]`;
    const underlyingAsset = testTokenA.address;
    const feeBuffer = "1000200000000000000"; // 1.0002
    const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
    const reserveRate = "100000000000000000"; // 0.1 - 10%
    const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
    const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

    // bucket 2
    const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
      nameBucket: bucketName2,
      assets: assets,
      pairPriceDrops: "['100000000000000000']",
      feeBuffer: feeBuffer,
      withdrawalFeeRate: withdrawalFeeRate, // 0.005 - 0.5%
      reserveRate: reserveRate,
      underlyingAsset: underlyingAsset,
      liquidityMiningRewardDistributor: "0",
      liquidityMiningAmount: "0",
      liquidityMiningDeadline: "0",
      stabilizationDuration: "0",
      pmxRewardAmount: "0",
      estimatedBar: estimatedBar,
      estimatedLar: estimatedLar,
      maxAmountPerUser: MaxUint256.toString(),
      barCalcParams: JSON.stringify(barCalcParams),
      maxTotalDeposit: MaxUint256.toString(),
    });

    bucket2 = await getContractAt("Bucket", newBucketAddress);

    const DepositManagerConfig = [
      {
        bucketAddress: bucket.address,
        rewardTokens: [
          {
            rewardTokenAddress: testTokenB.address,
            durations: [
              {
                durationInDays: 20,
                newInterestRate: "0.05",
              },
              {
                durationInDays: 15,
                newInterestRate: "0.06",
              },
            ],
          },
          {
            rewardTokenAddress: testTokenA.address,
            durations: [
              {
                durationInDays: 20,
                newInterestRate: "0.05",
              },
              {
                durationInDays: 15,
                newInterestRate: "0.06",
              },
            ],
          },
        ],
        maxTotalDeposit: "300",
      },
      {
        bucketAddress: bucket2.address,
        rewardTokens: [
          {
            rewardTokenAddress: testTokenB.address,
            durations: [
              {
                durationInDays: 5,
                newInterestRate: "0.03",
              },
              {
                durationInDays: 10,
                newInterestRate: "0.02",
              },
            ],
          },
        ],
        maxTotalDeposit: "200",
      },
    ];
    rewardParameters = [];

    for (const bucket of DepositManagerConfig) {
      const bucketRewardTokens = [];
      const bucketDurations = [];
      const bucketNewInterestRates = [];

      for (const token of bucket.rewardTokens) {
        const tokenDurations = [];
        const tokenNewInterestRates = [];
        for (const duration of token.durations) {
          tokenDurations.push(duration.durationInDays * SECONDS_PER_DAY);
          tokenNewInterestRates.push(parseEther(duration.newInterestRate).toString());
        }
        bucketRewardTokens.push(token.rewardTokenAddress);
        bucketDurations.push(tokenDurations);
        bucketNewInterestRates.push(tokenNewInterestRates);
      }
      rewardParameters.push({
        bucket: bucket.bucketAddress,
        rewardTokens: bucketRewardTokens,
        durations: bucketDurations,
        newInterestRates: bucketNewInterestRates,
        maxTotalDeposit: parseUnits(bucket.maxTotalDeposit, decimalsA),
      });
    }
    await DepositManager.setRewardParameters(rewardParameters);
  });

  describe("withdrawUnclaimedReward", function () {
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
    it("Should revert when a token is the P-Token", async function () {
      await DepositManager.setRewardParameters([
        {
          bucket: bucketAddress,
          rewardTokens: [testTokenB.address],
          durations: [[0]],
          newInterestRates: [[0]],
          maxTotalDeposit: parseEther("1"),
        },
      ]);
      await expect(
        DepositManager.withdrawUnclaimedReward([pTokenAddress], [parseEther("1")], deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_CANNOT_BE_P_TOKEN");
    });

    it("Should revert when the caller is not the BIG_TIMELOCK_ADMIN", async function () {
      await expect(
        DepositManager.connect(lender).withdrawUnclaimedReward([testTokenB.address], [parseEther("1")], deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should withdraw reward from DepositManager", async function () {
      await expect(
        DepositManager.withdrawUnclaimedReward([testTokenB.address], [parseEther("1")], deployer.address),
      ).to.changeTokenBalances(testTokenB, [DepositManager, deployer], [parseEther("1").mul(NegativeOne), parseEther("1")]);
    });
    it("Should revert when the amount exceeds withdrawable amount", async function () {
      await expect(
        DepositManager.withdrawUnclaimedReward([testTokenB.address], [parseEther("501")], deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_REWARD_TOKEN_BALANCE");
    });
  });

  describe("Deposit", function () {
    let depositParams;
    beforeEach(async function () {
      depositParams = {
        bucket: bucket.address,
        amount: depositAmount,
        duration: rewardParameters[0].durations[0][0],
        isPToken: false,
        depositReceiver: lender.address,
        rewardToken: testTokenB.address,
        borrowedRewardAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
        pullOracleTypes: [],
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

    it("Should revert if the depositManager is paused", async function () {
      await DepositManager.pause();
      await expect(DepositManager.connect(lender).deposit(depositParams)).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert if the depositReceiver is zero", async function () {
      await expect(
        DepositManager.connect(lender).deposit({ ...depositParams, depositReceiver: AddressZero }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if the msg.sender is on the blacklist", async function () {
      await WhiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(DepositManager.connect(mockContract).deposit(depositParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });

    it("Should revert if bucket is not added to primexDNS", async function () {
      const mockBucket = await deployMockBucket(deployer);
      await mockBucket.mock.name.returns("bucket2");
      const params = { ...depositParams, bucket: mockBucket.address };
      await expect(DepositManager.connect(lender).deposit(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_OUTSIDE_PRIMEX_PROTOCOL",
      );
    });

    it("Should revert if bucket is not active", async function () {
      await PrimexDNS.freezeBucket("bucket1");
      await expect(DepositManager.connect(lender).deposit(depositParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_NOT_ACTIVE",
      );
    });

    it("Should revert if rewardPercent is equal zero", async function () {
      const modifiedRewardParameters = JSON.parse(JSON.stringify(rewardParameters));
      modifiedRewardParameters[0].newInterestRates[0][0] = BigNumber.from(0);
      await DepositManager.setRewardParameters(modifiedRewardParameters);

      await expect(DepositManager.connect(lender).deposit(depositParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "REWARD_PERCENT_SHOULD_BE_GREATER_THAN_ZERO",
      );
    });

    it("Should revert if Deposit exceeds maxTotalDeposit", async function () {
      const modifiedRewardParameters = JSON.parse(JSON.stringify(rewardParameters));
      modifiedRewardParameters[0].maxTotalDeposit = depositAmount.sub("1");
      await DepositManager.setRewardParameters(modifiedRewardParameters);
      await expect(DepositManager.connect(lender).deposit(depositParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEPOSIT_EXCEEDS_MAX_TOTAL_DEPOSIT",
      );
    });

    it("Should revert if the deposit amount exceeds the withdrawable amount", async function () {
      const params = { ...depositParams, amount: parseUnits("500", decimalsA) };
      await testTokenA.approve(DepositManager.address, parseUnits("500", decimalsA));
      await expect(DepositManager.connect(lender).deposit(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEPOSIT_EXCEEDS_MAX_TOTAL_DEPOSIT",
      );
    });

    it("Should deposit and transfer to depositManager PToken amount when isPToken = true", async function () {
      const params = { ...depositParams, isPToken: true };

      await expect(DepositManager.connect(lender).deposit(params)).to.changeTokenBalances(
        pToken,
        [lender, DepositManager],
        [depositAmount.mul(NegativeOne), depositAmount],
      );
    });

    it("Should deposit and transfer amount from lender to depositManager and from depositManager to bucket when isPToken = false", async function () {
      await expect(DepositManager.connect(lender).deposit(depositParams)).to.changeTokenBalances(
        testTokenA,
        [lender, bucket],
        [depositAmount.mul(NegativeOne), depositAmount],
      );
      expect(await pToken.balanceOf(DepositManager.address)).to.equal(depositAmount);
      expect(await pToken.balanceOf(lender.address)).to.equal(lenderAmount);
    });

    it("Should deposit and push Deposit with correct values to deposits", async function () {
      const liquidityIndex = await bucket.liquidityIndex();
      const scaledAmount = rayDiv(depositAmount.toString(), liquidityIndex.toString()).toString();

      const rewardPercent = rewardParameters[0].newInterestRates[0][0];
      const duration = depositParams.duration;
      const price = await getExchangeRateByRoutes(testTokenA, await getEncodedChainlinkRouteViaUsd(testTokenB));
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
      const depositAmountInRewardAmount = wadMul(price.toString(), depositAmount.toString());
      const expectedRewardAmount = BigNumber.from(wadMul(depositAmountInRewardAmount.toString(), rewardPercent.toString()).toString())
        .mul(duration)
        .div(SECONDS_PER_YEAR)
        .toString();

      await DepositManager.connect(lender).deposit(depositParams);

      const expectedDeposit = [
        BigNumber.from(0),
        lender.address,
        bucket.address,
        BigNumber.from(scaledAmount),
        liquidityIndex,
        BigNumber.from((await provider.getBlock("latest")).timestamp + depositParams.duration),
        BigNumber.from((await provider.getBlock("latest")).timestamp),
        BigNumber.from(expectedRewardAmount),
        0, // claimed reward
        testTokenB.address, // reward token
      ];
      parseArguments(expectedDeposit, await DepositManager.getDepositInfoById("0"));
    });
    it("Should deposit for another address", async function () {
      const liquidityIndex = await bucket.liquidityIndex();
      const scaledAmount = rayDiv(depositAmount.toString(), liquidityIndex.toString()).toString();

      const rewardPercent = rewardParameters[0].newInterestRates[0][0];
      const duration = depositParams.duration;
      const price = await getExchangeRateByRoutes(testTokenA, await getEncodedChainlinkRouteViaUsd(testTokenB));
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
      const depositAmountInRewardAmount = wadMul(price.toString(), depositAmount.toString());
      const expectedRewardAmount = BigNumber.from(wadMul(depositAmountInRewardAmount.toString(), rewardPercent.toString()).toString())
        .mul(duration)
        .div(SECONDS_PER_YEAR)
        .toString();

      await DepositManager.connect(lender).deposit({ ...depositParams, depositReceiver: trader.address });

      const expectedDeposit = [
        BigNumber.from(0),
        trader.address,
        bucket.address,
        BigNumber.from(scaledAmount),
        liquidityIndex,
        BigNumber.from((await provider.getBlock("latest")).timestamp + depositParams.duration),
        BigNumber.from((await provider.getBlock("latest")).timestamp),
        BigNumber.from(expectedRewardAmount),
        0, // claimed reward
        testTokenB.address, // reward token
      ];
      parseArguments(expectedDeposit, await DepositManager.getDepositInfoById("0"));
    });

    it("Should deposit and emit event FixedTermDepositCreated", async function () {
      const depositId = BigNumber.from(0);
      const txDeposit = await DepositManager.connect(lender).deposit(depositParams);

      const expectedArguments = {
        user: lender.address,
        bucket: bucket.address,
        depositId: depositId,
        amount: depositAmount,
        duration: depositParams.duration,
      };

      eventValidation("FixedTermDepositCreated", await txDeposit.wait(), expectedArguments);
    });

    it("Should create a deposit and pay reward gradually", async function () {
      await network.provider.send("evm_mine");
      const depositId = BigNumber.from(0);
      const baseTime = (await provider.getBlock("latest")).timestamp + 1;
      await DepositManager.connect(lender).deposit(depositParams);

      const rewardPercent = rewardParameters[0].newInterestRates[0][0];
      const duration = depositParams.duration;
      const price = await getExchangeRateByRoutes(testTokenA, await getEncodedChainlinkRouteViaUsd(testTokenB));
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
      const depositAmountInRewardAmount = wadMul(price.toString(), depositAmount.toString());
      const expectedRewardAmount = BigNumber.from(wadMul(depositAmountInRewardAmount.toString(), rewardPercent.toString()).toString())
        .mul(duration)
        .div(SECONDS_PER_YEAR)
        .toString();

      // check that claimable amount is 0
      expect(await DepositManager.computeClaimableAmount(depositId)).to.be.equal(0);

      // set time to half the vesting period
      const halfTime = BigNumber.from(baseTime + duration / 2);

      await network.provider.send("evm_setNextBlockTimestamp", [Math.floor(halfTime.toNumber())]);

      await network.provider.send("evm_mine");

      // expect a half of the expectedRewardAmount
      const claimableAmount = await DepositManager.computeClaimableAmount(depositId);
      expect(claimableAmount).to.be.equal(BigNumber.from(expectedRewardAmount).div("2"));

      const timeFromStart = (await provider.getBlock("latest")).timestamp + 1 - baseTime;
      const vestedAmount = BigNumber.from(expectedRewardAmount).mul(timeFromStart).div(duration);

      //
      const expectWithdrawableAmountBeforeClaim = (await testTokenB.balanceOf(DepositManager.address)).sub(expectedRewardAmount);
      // should returns the correct amounts
      expect(await DepositManager.getWithdrawableAmount(testTokenB.address)).to.be.equal(expectWithdrawableAmountBeforeClaim);

      // claim a half of total reward token
      await expect(DepositManager.connect(lender).claimRewardTokens([depositId], [lender.address])).to.changeTokenBalances(
        testTokenB,
        [DepositManager, lender],
        [vestedAmount.mul(NegativeOne), vestedAmount],
      );

      const expectWithdrawableAmountAfterClaim = (await testTokenB.balanceOf(DepositManager.address))
        .add(vestedAmount)
        .sub(expectedRewardAmount);
      // should returns the correct amounts
      expect(await DepositManager.getWithdrawableAmount(testTokenB.address)).to.be.equal(expectWithdrawableAmountAfterClaim);

      const deposit = await DepositManager.getDepositInfoById("0");
      expect(deposit.claimedReward).to.be.equal(vestedAmount);

      // set time to the end of the deadline
      const afterDeadline = BigNumber.from(baseTime + duration + 10);
      await network.provider.send("evm_setNextBlockTimestamp", [Math.floor(afterDeadline.toNumber())]);
      await network.provider.send("evm_mine");

      expect(await DepositManager.computeClaimableAmount(depositId)).to.be.equal(BigNumber.from(expectedRewardAmount).sub(vestedAmount));

      // claim the remainder
      const txClaim = await DepositManager.connect(lender).claimRewardTokens([depositId], [lender.address]);

      const expectedArguments = {
        depositId: depositId,
        rewardReceiver: lender.address,
        rewardToken: depositParams.rewardToken,
        rewardAmount: BigNumber.from(expectedRewardAmount).sub(vestedAmount),
      };

      eventValidation("RewardPaid", await txClaim.wait(), expectedArguments);

      expect(await DepositManager.computeClaimableAmount(depositId)).to.be.equal(0);
      // try to claim with zero vested amount
      await expect(DepositManager.connect(lender).claimRewardTokens([depositId], [lender.address])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "VESTED_AMOUNT_IS_ZERO",
      );

      expect((await DepositManager.getDepositInfoById("0")).claimedReward).to.be.equal(expectedRewardAmount);
    });

    it("Should deposit and pay reward to rewardReceiver considering that the caller has the magic tier", async function () {
      const LendingNft = await getContract("LendingPrimexNFT");
      const mintParams = {
        chainId: network.config.chainId,
        id: 0,
        recipient: lender.address,
        deadline: (await provider.getBlock("latest")).timestamp + 100,
      };
      await LendingNft["mint((uint256,uint256,address,uint256))"](mintParams);
      await DepositManager.setMagicTierCoefficient(parseEther("2")); // x2
      const rewardPercent = rewardParameters[0].newInterestRates[0][0];
      const duration = depositParams.duration;
      const price = await getExchangeRateByRoutes(testTokenA, await getEncodedChainlinkRouteViaUsd(testTokenB));
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
      const depositAmountInRewardAmount = wadMul(price.toString(), depositAmount.toString());
      const expectedRewardAmount = BigNumber.from(
        wadMul(depositAmountInRewardAmount.toString(), BigNumber.from(rewardPercent).mul("2").toString()).toString(),
      )
        .mul(duration)
        .div(SECONDS_PER_YEAR)
        .toString();
      await DepositManager.connect(lender).deposit(depositParams);

      expect((await DepositManager.getDepositInfoById("0")).rewardAmount).to.be.equal(expectedRewardAmount);
    });
  });
  describe("Unlock", function () {
    let snapshotIdBase;
    let depositParams, depositParams2;
    before(async function () {
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
      depositParams = {
        bucket: bucket.address,
        amount: depositAmount,
        duration: rewardParameters[0].durations[0][0],
        isPToken: false,
        depositReceiver: lender.address,
        rewardReceiver: lender.address,
        rewardToken: testTokenB.address,
        borrowedRewardAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
        pullOracleTypes: [],
      };

      depositParams2 = {
        bucket: bucket2.address,
        amount: depositAmount,
        duration: rewardParameters[1].durations[0][0],
        isPToken: false,
        depositReceiver: lender.address,
        rewardReceiver: lender.address,
        rewardToken: testTokenB.address,
        borrowedRewardAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
        pullOracleTypes: [],
      };
      // deposit 00
      await DepositManager.connect(lender).deposit(depositParams);
      // deposit 01
      await DepositManager.connect(trader).deposit({ ...depositParams, depositReceiver: trader.address });
      // deposit 02
      await DepositManager.connect(lender).deposit(depositParams2);
      // deposit 03
      await DepositManager.connect(trader).deposit({ ...depositParams2, depositReceiver: trader.address });
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

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
    });

    it("Should revert if lock time is not expired", async function () {
      await expect(DepositManager.connect(lender).unlock([0], [lender.address], [true])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "LOCK_TIME_IS_NOT_EXPIRED",
      );
    });
    it("Should revert unlock if caller is not the owner of deposit", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);

      await expect(DepositManager.connect(trader).unlock([0], [lender.address], [true])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_OWNER",
      );
    });
    it("Should revert unlock if the length of the parameters does not match", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);

      await expect(DepositManager.connect(trader).unlock([0], [lender.address, trader.address], [true])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
      await expect(DepositManager.connect(trader).unlock([0], [lender.address], [true, false])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });

    it("Should unlock deposit and transfer to receiver depositAmount if shouldWithdraw = true", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);
      const withdrawalFeeRate = await bucket.withdrawalFeeRate();
      const amountToLender = wadMul(BigNumber.from(WAD).sub(withdrawalFeeRate).toString(), depositAmount.toString()).toString();
      const amountToTreasury = depositAmount.sub(amountToLender);

      await expect(DepositManager.connect(lender).unlock([0], [lender.address], [true])).to.changeTokenBalances(
        testTokenA,
        [bucket, lender, Treasury],
        [depositAmount.mul(NegativeOne), BigNumber.from(amountToLender), amountToTreasury],
      );
    });

    it("Should unlock deposit and transfer pTokens to receiver if shouldWithdraw = false", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);

      await expect(DepositManager.connect(lender).unlock([0], [lender.address], [false])).to.changeTokenBalances(
        pToken,
        [DepositManager, lender],
        [depositAmount.mul(NegativeOne), depositAmount],
      );
    });

    it("Should unlock deposit and emit event DepositUnlocked", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);
      const depositIdToUnlock = 0;
      const shouldWithdraw = false;
      const txUnlock = await DepositManager.connect(lender).unlock([depositIdToUnlock], [lender.address], [shouldWithdraw]);
      const expectedArguments = {
        depositId: depositIdToUnlock,
        receiver: depositParams.rewardReceiver,
        amount: depositAmount,
        shouldWithdraw: shouldWithdraw,
      };
      eventValidation("DepositUnlocked", await txUnlock.wait(), expectedArguments);
    });

    it("Should unlock deposits and delete unlocked Deposits", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);
      const depositsLengthBefore = await DepositManager.getAllDepositsLength();

      await expect(DepositManager.connect(lender).unlock([0], [lender.address], [false])).to.changeTokenBalances(
        pToken,
        [DepositManager, lender],
        [depositAmount.mul(NegativeOne), depositAmount],
      );

      const depositsLengthAfter = await DepositManager.getAllDepositsLength();
      expect(depositsLengthBefore).to.equal(depositsLengthAfter.add(1));
      // deposit 04
      await DepositManager.connect(lender).deposit(depositParams);
      // deposit 05
      await DepositManager.connect(trader).deposit({ ...depositParams, depositReceiver: trader.address });
      // deposit 06
      await DepositManager.connect(lender).deposit(depositParams2);
      // deposit 07
      await DepositManager.connect(trader).deposit({ ...depositParams2, depositReceiver: trader.address });

      const timestamp2 = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp2 + depositParams.duration]);

      await DepositManager.connect(lender).unlock([4], [lender.address], [false]);
      await DepositManager.connect(trader).unlock([1], [trader.address], [false]);
      await DepositManager.connect(trader).unlock([5], [trader.address], [false]);
      await DepositManager.connect(trader).unlock([7], [trader.address], [false]);

      // Flow
      // deposit new Deposits with ids: 00 /01 / 02 / 03
      // unlock: 00 => 03 /01 / 02
      // deposit new Deposits with ids: 03 /01 / 02 / 04 / 05 / 06 / 07
      // unlock 04 => 03 /01 / 02 / 07 / 05 / 06
      // unlock 01 => 03 /06 / 02 / 07 / 05
      // unlock 05 => 03 /06 / 02 / 07
      // unlock 07 => 03 /06 / 02

      const liquidityIndex2 = await bucket2.liquidityIndex();
      const scaledAmount2 = rayDiv(depositAmount.toString(), liquidityIndex2.toString()).toString();
      const deposit3 = await DepositManager.getDepositInfoById("3");
      const deposit6 = await DepositManager.getDepositInfoById("6");
      const deposit2 = await DepositManager.getDepositInfoById("2");

      const expectedDeposits = [
        {
          depositId: 3,
          owner: trader.address,
          bucket: depositParams2.bucket,
          scaledAmount: scaledAmount2,
          entryLiquidityIndex: liquidityIndex2,
          deadline: deposit3.deadline,
        },
        {
          depositId: 6,
          owner: lender.address,
          bucket: depositParams2.bucket,
          scaledAmount: scaledAmount2,
          entryLiquidityIndex: liquidityIndex2,
          deadline: deposit6.deadline,
        },
        {
          depositId: 2,
          owner: lender.address,
          bucket: depositParams2.bucket,
          scaledAmount: scaledAmount2,
          entryLiquidityIndex: liquidityIndex2,
          deadline: deposit2.deadline,
        },
      ];
      const [actualDeposits] = await DepositManager.getDeposits(0, 10);
      parseArguments(expectedDeposits, actualDeposits);

      await DepositManager.connect(trader).unlock([3], [trader.address], [false]);
      await DepositManager.connect(lender).unlock([6, 2], [lender.address, lender.address], [false, false]);
      const [deposits] = await DepositManager.getDeposits(0, 10);
      expect(deposits).to.deep.equal([]);
    });
  });
  describe("Getter functions", function () {
    let depositParams, depositParams2;
    before(async function () {
      depositParams = {
        bucket: bucket.address,
        amount: depositAmount,
        duration: rewardParameters[0].durations[0][0],
        isPToken: false,
        depositReceiver: lender.address,
        rewardReceiver: lender.address,
        rewardToken: testTokenB.address,
        borrowedRewardAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
        pullOracleTypes: [],
      };

      depositParams2 = {
        bucket: bucket2.address,
        amount: depositAmount,
        duration: rewardParameters[1].durations[0][0],
        isPToken: false,
        depositReceiver: lender.address,
        rewardReceiver: lender.address,
        rewardToken: testTokenB.address,
        borrowedRewardAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pullOracleData: [],
        pullOracleTypes: [],
      };
      // deposit 00
      await DepositManager.connect(lender).deposit(depositParams);
      // deposit 01
      await DepositManager.connect(trader).deposit({ ...depositParams, depositReceiver: trader.address });
      // deposit 02
      await DepositManager.connect(lender).deposit(depositParams2);
      // deposit 03
      await DepositManager.connect(trader).deposit({ ...depositParams2, depositReceiver: trader.address });
      // deposit 04
      await DepositManager.connect(lender).deposit(depositParams);
      // deposit 05
      await DepositManager.connect(trader).deposit({ ...depositParams, depositReceiver: trader.address });
      // deposit 06
      await DepositManager.connect(lender).deposit(depositParams2);
      // deposit 07
      await DepositManager.connect(trader).deposit({ ...depositParams2, depositReceiver: trader.address });

      const timestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [timestamp + depositParams.duration]);

      await DepositManager.connect(lender).unlock([4], [lender.address], [false]);
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
    it("Should return correct Deposit by Id", async function () {
      const liquidityIndex2 = await bucket2.liquidityIndex();
      const scaledAmount2 = rayDiv(depositAmount.toString(), liquidityIndex2.toString()).toString();
      const deposit3 = await DepositManager.getDepositInfoById("3");
      const deposit6 = await DepositManager.getDepositInfoById("6");

      const expectedDeposit3 = {
        depositId: 3,
        owner: trader.address,
        bucket: depositParams2.bucket,
        scaledAmount: scaledAmount2,
        entryLiquidityIndex: liquidityIndex2,
        deadline: deposit3.deadline,
        depositStart: deposit3.depositStart,
        rewardAmount: deposit3.rewardAmount,
        claimedReward: deposit3.claimedReward,
        rewardToken: deposit3.rewardToken,
      };
      const expectedDeposit6 = {
        depositId: 6,
        owner: lender.address,
        bucket: depositParams2.bucket,
        scaledAmount: scaledAmount2,
        entryLiquidityIndex: liquidityIndex2,
        deadline: deposit6.deadline,
        depositStart: deposit6.depositStart,
        rewardAmount: deposit6.rewardAmount,
        claimedReward: deposit6.claimedReward,
        rewardToken: deposit6.rewardToken,
      };

      parseArguments(expectedDeposit3, await DepositManager.getDepositInfoById(3));
      parseArguments(expectedDeposit6, await DepositManager.getDepositInfoById(6));
    });

    it("Should return correct getAllDepositsLength", async function () {
      expect(await DepositManager.getAllDepositsLength()).to.equal(7);
    });

    it("Should get correct Bucket posible durations", async function () {
      const expectedDurations = rewardParameters[0].durations[0];
      expect(await DepositManager.getBucketPosibleDurations(bucket.address, testTokenB.address)).to.deep.equal(expectedDurations);
    });

    it("Should get correct Bucket reward tokens", async function () {
      const expectedRerwardTokens = rewardParameters[0].rewardTokens;
      expect(await DepositManager.getBucketRewardTokens(bucket.address)).to.deep.equal(expectedRerwardTokens);
    });

    it("Should get correct deposits by User", async function () {
      const liquidityIndex = await bucket.liquidityIndex();
      const scaledAmount = rayDiv(depositAmount.toString(), liquidityIndex.toString()).toString();

      const liquidityIndex2 = await bucket2.liquidityIndex();
      const scaledAmount2 = rayDiv(depositAmount.toString(), liquidityIndex2.toString()).toString();
      const deposit0 = await DepositManager.getDepositInfoById("0");
      const deposit2 = await DepositManager.getDepositInfoById("2");
      const deposit6 = await DepositManager.getDepositInfoById("6");

      const expectedDeposits = [
        {
          depositId: 0,
          owner: lender.address,
          bucket: depositParams.bucket,
          scaledAmount: scaledAmount,
          entryLiquidityIndex: liquidityIndex,
          deadline: deposit0.deadline,
          depositStart: deposit0.depositStart,
          rewardAmount: deposit0.rewardAmount,
          claimedReward: deposit0.claimedReward,
          rewardToken: deposit0.rewardToken,
        },
        {
          depositId: 2,
          owner: lender.address,
          bucket: depositParams2.bucket,
          scaledAmount: scaledAmount2,
          entryLiquidityIndex: liquidityIndex2,
          deadline: deposit2.deadline,
          depositStart: deposit2.depositStart,
          rewardAmount: deposit2.rewardAmount,
          claimedReward: deposit2.claimedReward,
          rewardToken: deposit2.rewardToken,
        },
        {
          depositId: 6,
          owner: lender.address,
          bucket: depositParams2.bucket,
          scaledAmount: scaledAmount2,
          entryLiquidityIndex: liquidityIndex2,
          deadline: deposit6.deadline,
          depositStart: deposit6.depositStart,
          rewardAmount: deposit6.rewardAmount,
          claimedReward: deposit6.claimedReward,
          rewardToken: deposit6.rewardToken,
        },
      ];
      const [userDepositsData] = await DepositManager.getDepositsByUser(lender.address, 0, 10);
      parseArguments(expectedDeposits, userDepositsData);
    });

    it("Should get correct deposits by Bucket", async function () {
      const liquidityIndex = await bucket.liquidityIndex();
      const scaledAmount = rayDiv(depositAmount.toString(), liquidityIndex.toString()).toString();

      const deposit0 = await DepositManager.getDepositInfoById("0");
      const deposit1 = await DepositManager.getDepositInfoById("1");
      const deposit5 = await DepositManager.getDepositInfoById("5");

      const expectedDeposits = [
        {
          depositId: 0,
          owner: lender.address,
          bucket: depositParams.bucket,
          scaledAmount: scaledAmount,
          entryLiquidityIndex: liquidityIndex,
          deadline: deposit0.deadline,
          depositStart: deposit0.depositStart,
          rewardAmount: deposit0.rewardAmount,
          claimedReward: deposit0.claimedReward,
          rewardToken: deposit0.rewardToken,
        },
        {
          depositId: 1,
          owner: trader.address,
          bucket: depositParams.bucket,
          scaledAmount: scaledAmount,
          entryLiquidityIndex: liquidityIndex,
          deadline: deposit1.deadline,
          depositStart: deposit1.depositStart,
          rewardAmount: deposit1.rewardAmount,
          claimedReward: deposit1.claimedReward,
          rewardToken: deposit1.rewardToken,
        },
        {
          depositId: 5,
          owner: trader.address,
          bucket: depositParams.bucket,
          scaledAmount: scaledAmount,
          entryLiquidityIndex: liquidityIndex,
          deadline: deposit5.deadline,
          depositStart: deposit5.depositStart,
          rewardAmount: deposit5.rewardAmount,
          claimedReward: deposit5.claimedReward,
          rewardToken: deposit5.rewardToken,
        },
      ];
      const [bucketDepositsData] = await DepositManager.getDepositsByBucket(bucket.address, 0, 10);

      parseArguments(expectedDeposits, bucketDepositsData);
    });

    it("Should get all user depositIds", async function () {
      const lenderIds = [0, 2, 6];
      const traderIds = [1, 3, 5, 7];
      expect(await DepositManager.getUserDepositIds(lender.address)).to.deep.equal(lenderIds);
      expect(await DepositManager.getUserDepositIds(trader.address)).to.deep.equal(traderIds);
    });

    it("Should get all bucket depositIds", async function () {
      const bucket1Ids = [0, 1, 5];
      const bucket2Ids = [2, 3, 6, 7];
      expect(await DepositManager.getBucketDepositIds(bucket.address)).to.deep.equal(bucket1Ids);
      expect(await DepositManager.getBucketDepositIds(bucket2.address)).to.deep.equal(bucket2Ids);
    });
  });
});
