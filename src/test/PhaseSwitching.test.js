// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, AddressZero },
    BigNumber,
    provider,
  },
  deployments: { fixture },
} = require("hardhat");

const { Role } = require("./utils/activityRewardDistributorMath");
const { spotTradingRewards, earlyLendersRewards, earlyTradersRewards } = require("../tasks/deployScripts/phaseSwitching/config.json");
const { wadDiv, MAX_TOKEN_DECIMALITY } = require("./utils/bnMath");
const { getAmountsOut, addLiquidity, getSingleMegaRoute } = require("./utils/dexOperations");
const { USD_DECIMALS, USD_MULTIPLIER } = require("./utils/constants");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("./utils/oracleUtils");
process.env.TEST = true;

describe("PhaseSwitching", function () {
  let bigTimelock;
  let dex, positionManager, testTokenA, testTokenB, bucket, PrimexDNS, bucketAddress, firstAssetRoutes;
  let priceOracle;
  let trader, lender;
  let decimalsA, decimalsB;
  let multiplierA, multiplierB;
  let OpenPositionParams;
  let positionAmount, price, depositAmount, borrowedAmount, swapSize;
  let spotTradingRewardDistributor, activityRewardDistributor;

  before(async function () {
    await fixture(["Test"]);

    ({ trader, lender } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    positionManager = await getContract("PositionManager");
    bigTimelock = await getContract("BigTimelockAdmin");
    spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
    activityRewardDistributor = await getContract("ActivityRewardDistributor");

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    dex = process.env.DEX ? process.env.DEX : "uniswap";

    firstAssetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    priceOracle = await getContract("PriceOracle");
    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    depositAmount = parseUnits("1", decimalsA);
    borrowedAmount = parseUnits("1", decimalsA);
    swapSize = depositAmount.add(borrowedAmount);

    const lenderAmount = parseUnits("50", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
    await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
    const deadline = new Date().getTime() + 600;

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      closeConditions: [],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
    const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price);
  });

  describe("Should switch to phase 1 - deploy", function () {
    before(async function () {});

    it("Should not add reward for spot trading", async function () {
      expect(await spotTradingRewardDistributor.rewardPerPeriod()).to.equal(0);
      expect(await spotTradingRewardDistributor.undistributedPMX()).to.equal(0);

      // open spot position and check reward is 0
      const marginParams = {
        bucket: "",
        borrowedAmount: BigNumber.from(0),
        depositToBorrowedRoutes: [],
        depositInThirdAssetMegaRoutes: [],
      };
      const singleUpdateFeeInWei = 1;
      const updateFeeAmount = singleUpdateFeeInWei * OpenPositionParams.pullOracleData.length;

      const params = { ...OpenPositionParams, marginParams };
      await positionManager.connect(trader).openPosition(params, { value: updateFeeAmount });
      const [reward] = await spotTradingRewardDistributor.calculateReward(trader.address);
      expect(reward).to.equal(0);
    });

    it("Should not add rewards for early lenders", async function () {
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();
      const activityRewardDistributor = await getContract("ActivityRewardDistributor");
      for (let i = 0; i < buckets.length; i++) {
        const bucketInfo = await activityRewardDistributor.buckets(buckets[i], Role.LENDER);
        expect(bucketInfo.rewardPerDay).to.equal(0);
        expect(bucketInfo.totalReward).to.equal(0);
      }
      // deposit to bucket and check reward is 0
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("10", decimalsA), true);
      const lenderInfo = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.LENDER, lender.address);
      expect(lenderInfo.fixedReward).to.equal(0);
    });

    it("Should not add rewards for early traders", async function () {
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();
      const activityRewardDistributor = await getContract("ActivityRewardDistributor");
      for (let i = 0; i < buckets.length; i++) {
        const bucketInfo = await activityRewardDistributor.buckets(buckets[i], Role.TRADER);
        expect(bucketInfo.rewardPerDay).to.equal(0);
        expect(bucketInfo.totalReward).to.equal(0);
      }
      // open position and check reward is 0
      const swap = swapSize.mul(multiplierA);
      positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = positionAmount.mul(multiplierB);
      const price0 = wadDiv(amountB, swap);
      price = price0.div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      const singleUpdateFeeInWei = 1;
      const updateFeeAmount = singleUpdateFeeInWei * OpenPositionParams.pullOracleData.length;
      await positionManager.connect(trader).openPosition(OpenPositionParams, { value: updateFeeAmount });
      const traderInfo = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
      expect(traderInfo.fixedReward).to.equal(0);
    });

    it("Should not enable NFT bonuses", async function () {
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();
      for (let i = 0; i < buckets.length; i++) {
        const bucket = await getContractAt("Bucket", buckets[i]);
        const pTokenAddress = await bucket.pToken();
        const pToken = await getContractAt("PToken", pTokenAddress);
        expect(await pToken.interestIncreaser()).to.equal(AddressZero);

        const debtTokenAddress = await bucket.debtToken();
        const debtToken = await getContractAt("DebtToken", debtTokenAddress);
        expect(await debtToken.feeDecreaser()).to.equal(AddressZero);
      }
    });
  });

  describe("Should switch to phase 2 - spot trading rewards", function () {
    before(async function () {
      await run("setup:phase-2-proposal");
      const delay = await bigTimelock.getMinDelay();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await run("setup:phase-2-execution");
    });

    it("Should set correct params in spotTradingRewardDistributor", async function () {
      expect(await spotTradingRewardDistributor.rewardPerPeriod()).to.be.equal(parseEther(spotTradingRewards.rewardPerPeriod));
      expect(await spotTradingRewardDistributor.undistributedPMX()).to.be.equal(parseEther(spotTradingRewards.pmxAmountToTransfer));
      expect(await positionManager.spotTradingRewardDistributor()).to.be.equal(spotTradingRewardDistributor.address);
    });

    it("Should add reward for spot trading", async function () {
      const spotSwap = swapSize.mul(2);
      const swap = spotSwap.mul(multiplierA);
      positionAmount = await getAmountsOut(dex, spotSwap, [testTokenA.address, testTokenB.address]);
      const amountB = positionAmount.mul(multiplierB);
      const price0 = wadDiv(amountB, swap);
      price = price0.div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      const marginParams = {
        bucket: "",
        borrowedAmount: BigNumber.from(0),
        depositToBorrowedRoutes: [],
        depositInThirdAssetMegaRoutes: [],
      };
      const params = { ...OpenPositionParams, marginParams: marginParams };
      const singleUpdateFeeInWei = 1;
      const updateFeeAmount = singleUpdateFeeInWei * OpenPositionParams.pullOracleData.length;
      await positionManager.connect(trader).openPosition(params, { value: updateFeeAmount });

      const delay = await spotTradingRewardDistributor.periodDuration();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);

      await positionManager.connect(trader).openPosition(params, { value: updateFeeAmount });

      const [reward] = await spotTradingRewardDistributor.calculateReward(trader.address);
      expect(reward).to.be.gt(0);
    });
  });

  describe("Should switch to phase 3 - rewards for early lenders", function () {
    before(async function () {
      await run("setup:phase-3-proposal");
      const delay = await bigTimelock.getMinDelay();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await run("setup:phase-3-execution");
    });
    it("Should set correct params in ActivityRewardDistributor", async function () {
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();
      for (let i = 0; i < buckets.length; i++) {
        const bucketInfo = await activityRewardDistributor.buckets(buckets[i], Role.LENDER);
        expect(bucketInfo.rewardPerDay).to.be.equal(parseEther(earlyLendersRewards.rewardPerDay));
        expect(bucketInfo.totalReward).to.be.equal(parseEther(earlyLendersRewards.totalReward));

        const bucket = await getContractAt("Bucket", buckets[i]);
        const pTokenAddress = await bucket.pToken();
        const pToken = await getContractAt("PToken", pTokenAddress);
        expect(await pToken.lenderRewardDistributor()).to.equal(activityRewardDistributor.address);
      }
    });
    it("Should add rewards for early lenders", async function () {
      await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("10", decimalsA), true);
      await network.provider.send("evm_mine");
      const reward = await activityRewardDistributor.getClaimableReward([[bucket.address, Role.LENDER]], lender.address);
      expect(reward).to.be.gt(0);
    });
  });

  describe("Should switch to phase 4 - rewards for early traders", function () {
    before(async function () {
      await run("setup:phase-4-proposal");
      const delay = await bigTimelock.getMinDelay();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await run("setup:phase-4-execution");
    });

    it("Should set correct params in ActivityRewardDistributor", async function () {
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();

      for (let i = 0; i < buckets.length; i++) {
        const bucketInfo = await activityRewardDistributor.buckets(buckets[i], Role.TRADER);
        expect(bucketInfo.rewardPerDay).to.be.equal(parseEther(earlyTradersRewards.rewardPerDay));
        expect(bucketInfo.totalReward).to.be.equal(parseEther(earlyTradersRewards.totalReward));

        const bucket = await getContractAt("Bucket", buckets[i]);
        const debtTokenAddress = await bucket.debtToken();
        const debtToken = await getContractAt("DebtToken", debtTokenAddress);
        expect(await debtToken.traderRewardDistributor()).to.equal(activityRewardDistributor.address);
      }
    });
    it("Should add rewards for early traders", async function () {
      const swap = swapSize.mul(multiplierA);
      positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = positionAmount.mul(multiplierB);
      const price0 = wadDiv(amountB, swap);
      price = price0.div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
      const singleUpdateFeeInWei = 1;
      const updateFeeAmount = singleUpdateFeeInWei * OpenPositionParams.pullOracleData.length;
      await positionManager.connect(trader).openPosition(OpenPositionParams, { value: updateFeeAmount });
      await network.provider.send("evm_mine");
      const reward = await activityRewardDistributor.getClaimableReward([[bucket.address, Role.TRADER]], trader.address);
      expect(reward).to.be.gt(0);
    });
  });

  describe("Should switch to phase 5 - enable NFT bonuses", function () {
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      await run("setup:phase-5-proposal");
      const delay = await bigTimelock.getMinDelay();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await run("setup:phase-5-execution");
    });
    it("Should enable NFT bonuses", async function () {
      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();

      const FeeDecreaser = await getContract("FeeDecreaser");
      const InterestIncreaser = await getContract("InterestIncreaser");
      for (let i = 0; i < buckets.length; i++) {
        const bucket = await getContractAt("Bucket", buckets[i]);
        const pTokenAddress = await bucket.pToken();
        const pToken = await getContractAt("PToken", pTokenAddress);
        expect(await pToken.interestIncreaser()).to.equal(InterestIncreaser.address);

        const debtTokenAddress = await bucket.debtToken();
        const debtToken = await getContractAt("DebtToken", debtTokenAddress);
        expect(await debtToken.feeDecreaser()).to.equal(FeeDecreaser.address);
      }
    });
  });

  describe("Should switch to phase 6 - update from ePMX to PMX", function () {
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      await run("setup:phase-6-proposal");
      const delay = await bigTimelock.getMinDelay();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await run("setup:phase-6-execution");
    });
    it("Should switch from ePMX to PMX", async function () {
      const PrimexDNS = await getContract("PrimexDNS");
      const PositionManager = await getContract("PositionManager");
      const newPmx = await getContract("PMXToken");

      expect(await PrimexDNS.pmx()).to.equal(newPmx.address);
      const spotTradingRewardDistributor = await getContractAt(
        "SpotTradingRewardDistributor",
        await PositionManager.spotTradingRewardDistributor(),
      );
      expect(await spotTradingRewardDistributor.pmx()).to.equal(newPmx.address);
      const keeperRewardDistributor = await getContractAt("KeeperRewardDistributor", await PositionManager.keeperRewardDistributor());
      expect(await keeperRewardDistributor.pmx()).to.equal(newPmx.address);

      const newActivityRewardDistributor = await getContract("ActivityRewardDistributorNewPmx");

      const BucketsFactory = await getContract("BucketsFactoryV2");
      const buckets = await BucketsFactory.allBuckets();
      for (let i = 0; i < buckets.length; i++) {
        const bucket = await getContractAt("Bucket", buckets[i]);
        const pTokenAddress = await bucket.pToken();
        const pToken = await getContractAt("PToken", pTokenAddress);
        expect(await pToken.lenderRewardDistributor()).to.equal(newActivityRewardDistributor.address);

        const debtTokenAddress = await bucket.debtToken();
        const debtToken = await getContractAt("DebtToken", debtTokenAddress);
        expect(await debtToken.traderRewardDistributor()).to.equal(newActivityRewardDistributor.address);
      }
    });
  });
});
