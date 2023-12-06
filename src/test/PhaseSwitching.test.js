// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
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
const { getAmountsOut, addLiquidity, getSingleRoute } = require("./utils/dexOperations");
const { NATIVE_CURRENCY, USD } = require("./utils/constants");
process.env.TEST = true;

describe("PhaseSwitching", function () {
  let bigTimelock;
  let dex, positionManager, testTokenA, testTokenB, bucket, tokenUSD, PrimexDNS, bucketAddress, firstAssetRoutes;
  let priceFeed, priceOracle, priceFeedTTBETH, priceFeedTTAETH;
  let deployer, trader, lender;
  let decimalsA, decimalsB, decimalsUSD;
  let multiplierA, multiplierB;
  let OpenPositionParams;
  let positionAmount, price, depositAmount, borrowedAmount, swapSize;
  let PMXToken;
  let spotTradingRewardDistributor, activityRewardDistributor;

  before(async function () {
    await fixture(["Test"]);

    ({ deployer, trader, lender } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    // dec = await
    PrimexDNS = await getContract("PrimexDNS");
    PMXToken = await getContract("EPMXToken");
    positionManager = await getContract("PositionManager");
    bigTimelock = await getContract("BigTimelockAdmin");
    spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
    activityRewardDistributor = await getContract("ActivityRewardDistributor");

    await positionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    dex = process.env.DEX ? process.env.DEX : "uniswap";

    firstAssetRoutes = await getSingleRoute([testTokenA.address, testTokenB.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    tokenUSD = await getContract("USD Coin");
    decimalsUSD = await tokenUSD.decimals();
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_PMX", deployer.address);
    priceFeedTTBETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_ETH", deployer.address);
    priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    const ttaPriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);

    const decimalsPMX = await PMXToken.decimals();
    await priceFeedTTAPMX.setDecimals(decimalsPMX);
    const ttaPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 tta=0.2 pmx
    await priceFeedTTAPMX.setAnswer(ttaPriceInPMX);

    const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTD_USD", deployer.address);
    await priceFeedTTBUSD.setAnswer(parseUnits("1", "8"));
    await priceFeedTTBUSD.setDecimals("8");

    await priceFeedTTBETH.setAnswer(parseUnits("10000", decimalsUSD));
    await priceFeedTTBETH.setDecimals(decimalsUSD);

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals(decimalsA);

    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenB.address, testTokenA.address, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenA.address, PMXToken.address, priceFeedTTAPMX.address);
    await priceOracle.updatePriceFeed(testTokenA.address, NATIVE_CURRENCY, priceFeedTTAETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, NATIVE_CURRENCY, priceFeedTTBETH.address);
    await priceOracle.updatePriceFeed(testTokenB.address, USD, priceFeedTTBUSD.address);

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
        depositInThirdAssetRoutes: [],
      },
      firstAssetRoutes: firstAssetRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      payFeeFromWallet: true,
      closeConditions: [],
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const price0 = wadDiv(swap, amountB);
    price = price0.div(multiplierA);
    await priceFeed.setAnswer(price);
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
        depositInThirdAssetRoutes: [],
      };
      const params = { ...OpenPositionParams, marginParams };
      await positionManager.connect(trader).openPosition(params, { value: parseEther("1") });
      const [reward] = await spotTradingRewardDistributor.calculateReward(trader.address);
      expect(reward).to.equal(0);
    });

    it("Should not add rewards for early lenders", async function () {
      const BucketsFactory = await getContract("BucketsFactory");
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
      const BucketsFactory = await getContract("BucketsFactory");
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
      const price0 = wadDiv(swap, amountB);
      price = price0.div(multiplierA);
      await priceFeed.setAnswer(price);
      await positionManager.connect(trader).openPosition(OpenPositionParams, { value: parseEther("1") });
      const traderInfo = await activityRewardDistributor.getUserInfoFromBucket(bucket.address, Role.TRADER, trader.address);
      expect(traderInfo.fixedReward).to.equal(0);
    });

    it("Should not enable NFT bonuses", async function () {
      const BucketsFactory = await getContract("BucketsFactory");
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
      const price0 = wadDiv(swap, amountB);
      price = price0.div(multiplierA);
      await priceFeed.setAnswer(price);

      const marginParams = {
        bucket: "",
        borrowedAmount: BigNumber.from(0),
        depositToBorrowedRoutes: [],
        depositInThirdAssetRoutes: [],
      };
      const params = { ...OpenPositionParams, marginParams: marginParams };
      await positionManager.connect(trader).openPosition(params, { value: parseEther("1") });

      const delay = await spotTradingRewardDistributor.periodDuration();
      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);

      await positionManager.connect(trader).openPosition(params, { value: parseEther("1") });

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
      const BucketsFactory = await getContract("BucketsFactory");
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
      const BucketsFactory = await getContract("BucketsFactory");
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
      const price0 = wadDiv(swap, amountB);
      price = price0.div(multiplierA);
      await priceFeed.setAnswer(price);
      await positionManager.connect(trader).openPosition(OpenPositionParams, { value: parseEther("1") });
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
      const BucketsFactory = await getContract("BucketsFactory");
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

      const BucketsFactory = await getContract("BucketsFactory");
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
