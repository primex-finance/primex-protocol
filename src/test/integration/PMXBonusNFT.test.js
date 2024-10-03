// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const { BigNumber } = require("ethers");
const {
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getSigners,
    utils: { parseEther, parseUnits, keccak256, toUtf8Bytes },
    constants: { MaxUint256, AddressZero },
  },

  deployments: { fixture },
} = require("hardhat");
const { BigNumber: BN } = require("bignumber.js");
const { MAX_TOKEN_DECIMALITY, USD_DECIMALS, USD_MULTIPLIER } = require("../utils/constants");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("../utils/oracleUtils");

process.env.TEST = true;

const { addLiquidity, checkIsDexSupported, getAmountsOut, getSingleMegaRoute } = require("../utils/dexOperations");
const { rayMul, wadDiv, rayDiv, calculateCompoundInterest, wadMul, calculateLinearInterest } = require("../utils/math");
const { signNftMintData } = require("../utils/generateSignature.js");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");

describe("PrimexNFT_integration", function () {
  let user, lender, trader, deployer;
  let InterestIncreaser,
    FeeDecreaser,
    PrimexNft,
    PriceFeed,
    PrimexDNS,
    Bucket,
    PositionManager,
    testTokenA,
    PTokenA,
    DebtTokenA,
    Reserve,
    testTokenB;
  let percent, maxAmount, deadline, multiplierA, multiplierB, decimalsA, decimalsB;
  let uris;
  let dex, firstAssetRoutes;

  before(async function () {
    await fixture(["Test"]);
    [deployer, user, lender, trader] = await getSigners();
    PrimexNft = await getContract("PMXBonusNFT");
    FeeDecreaser = await getContract("FeeDecreaser");
    InterestIncreaser = await getContract("InterestIncreaser");
    PrimexDNS = await getContract("PrimexDNS");
    PositionManager = await getContract("PositionManager");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    const registry = await getContract("Registry");
    const NFT_MINTER = keccak256(toUtf8Bytes("NFT_MINTER"));

    await registry.grantRole(NFT_MINTER, deployer.address);

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await PositionManager.setProtocolParamsByAdmin(payload);

    await PrimexNft.setExecutor(1, InterestIncreaser.address);
    await PrimexNft.setExecutor(2, FeeDecreaser.address);
    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    Bucket = await getContractAt("Bucket", bucketAddress);
    await InterestIncreaser.setMaxBonusCount(Bucket.address, 5);
    await FeeDecreaser.setMaxBonusCount(Bucket.address, 5);
    // deposit

    const pTokenAddress = await Bucket.pToken();
    const debtTokenAddress = await Bucket.debtToken();
    const reserveAddress = await Bucket.reserve();

    PTokenA = await getContractAt("PToken", pTokenAddress);
    DebtTokenA = await getContractAt("DebtToken", debtTokenAddress);
    Reserve = await getContractAt("Reserve", reserveAddress);

    await PTokenA.setInterestIncreaser(InterestIncreaser.address);
    await DebtTokenA.setFeeDecreaser(FeeDecreaser.address);

    const deposit = parseUnits("100", decimalsA);
    await testTokenA.mint(lender.address, deposit);
    await testTokenA.connect(lender).approve(Bucket.address, MaxUint256);
    await Bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, deposit, true);

    dex = process.env.DEX || "uniswap";
    checkIsDexSupported(dex);
    firstAssetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    PriceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    const priceOracle = await getContract("PriceOracle");

    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));
    // borrow
    const borrowedAmount = parseUnits("5", decimalsA);
    const depositAmount = parseUnits("3", decimalsA);

    await testTokenA.mint(trader.address, MaxUint256.div(2));
    await testTokenA.connect(trader).approve(PositionManager.address, MaxUint256);

    const swapAmount = borrowedAmount.add(depositAmount);
    const swap = swapAmount.mul(multiplierA);
    const amount0Out = await getAmountsOut(dex, swapAmount, [testTokenA.address, testTokenB.address]);
    const amountB = amount0Out.mul(multiplierB);
    const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
    const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price);

    await PositionManager.connect(trader).openPosition({
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetRoutes,
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: Math.round(new Date().getTime() / 1000) + 600,
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
    });

    uris = ["primexURL/" + "37" + "0", "primexURL/" + "37" + "1"];

    percent = parseEther("0.1");
    maxAmount = parseEther("1");
    deadline = 60 * 60 * 24 * 7; // week
    const tiers = [0, 1, 2, 3, 4];
    const bonuses = [
      { percent: percent, maxAmount: maxAmount, duration: deadline }, // don't use
      { percent: percent, maxAmount: maxAmount, duration: deadline },
      { percent: percent, maxAmount: 5, duration: deadline },
      { percent: percent, maxAmount: 1000, duration: deadline },
      { percent: percent, maxAmount: 1000, duration: deadline }, // don't use
    ];
    await InterestIncreaser.setTierBonus(bucketAddress, tiers, bonuses);
    await FeeDecreaser.setTierBonus(bucketAddress, tiers, bonuses);
  });

  async function _increaseAccumulatedAmount(balance, lastUpdatedIndex, blockAmount = 50, isLinearInterest = true) {
    for (let i = 0; i < blockAmount; i++) {
      await provider.send("evm_mine");
    }

    const lastUpdBlockTimestamp = await Bucket.lastUpdatedBlockTimestamp();
    const txBlockTimestamp = lastUpdBlockTimestamp.add(200);
    await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

    let currentIndex;
    if (isLinearInterest) {
      const LAR = await Bucket.lar();
      const linearInterest = calculateLinearInterest(BN(LAR.toString()), lastUpdBlockTimestamp.toString(), txBlockTimestamp.toString())
        .dp(0, 1)
        .toString();
      const liquidityIndex = await Bucket.liquidityIndex();
      currentIndex = rayMul(linearInterest, liquidityIndex.toString()).toString();
    } else {
      const BAR = await Bucket.bar();
      const compoundInterest = calculateCompoundInterest(BN(BAR.toString()), lastUpdBlockTimestamp.toString(), txBlockTimestamp.toString())
        .dp(0, 1)
        .toString();
      const variableBorrowIndex = await Bucket.variableBorrowIndex();
      currentIndex = rayMul(compoundInterest, variableBorrowIndex.toString()).toString();
    }
    const amount = wadMul(percent.toString(), balance.toString()).toString();
    const accumulatedAmount = rayMul(amount, BN(currentIndex).minus(lastUpdatedIndex.toString())).toString();
    return [currentIndex, accumulatedAmount];
  }

  describe("InterestIncreaser", function () {
    let snapshotId;
    let mintParams, sig;

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
      mintParams = {
        bonusTypeId: 1,
        tier: 1,
        chainId: network.config.chainId,
        id: 37,
        recipient: lender.address,
        uris: uris,
      };
      mintParams.uris = ["primexURL/" + mintParams.id + "0", "primexURL/" + mintParams.id + "1"];
      sig = await signNftMintData(deployer, mintParams);
      await PrimexNft.connect(lender)["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](sig, mintParams);
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should block NFT and delete the activated bonus in the executor", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");
      expect((await InterestIncreaser.getBonus(lender.address, mintParams.id)).bucket).to.be.equal(Bucket.address);
      await PrimexNft.blockNft(mintParams.id);
      expect((await InterestIncreaser.getBonus(lender.address, mintParams.id)).bucket).to.be.equal(AddressZero);
    });
    it("Should activate nft both in the Nft and in the BonusExecutor contract", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");

      const expectActivatedBonus = [
        BigNumber.from(mintParams.id),
        Bucket.address,
        percent,
        maxAmount,
        BigNumber.from(0),
        await Bucket.getNormalizedIncome(),
        BigNumber.from(timestamp).add(deadline).add(1),
        BigNumber.from(0),
      ];
      const activatedBonus = await InterestIncreaser.getBonus(lender.address, mintParams.id);

      expect(activatedBonus).to.deep.equal(expectActivatedBonus);
      expect((await PrimexNft.getNft(mintParams.id)).activatedBy).to.be.equal(lender.address);
      expect((await PrimexNft.getNft(mintParams.id)).uri).to.be.equal(uris[1]);
    });

    it("Should update the activated bonus via transfer pTokens", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");
      const balance = await PTokenA.scaledBalanceOf(lender.address);
      const transferAmount = balance.div("2");
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);

      const [currentIncome, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);
      await PTokenA.connect(lender).transfer(user.address, transferAmount);

      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await InterestIncreaser.getBonus(
        lender.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(currentIncome);
    });

    it("Should correct return accumulatedAmount when caller isn't _user", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");
      const balance = await PTokenA.scaledBalanceOf(lender.address);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);

      const [, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);

      // mine 1 block because _increaseAccumulatedAmount calculate accumulatedAmount for next block
      await provider.send("evm_mine");

      const contractAccumulatedAmount = await InterestIncreaser.getAccumulatedAmount(lender.address, mintParams.id);

      expect(contractAccumulatedAmount).to.be.equal(accumulatedAmount);
    });
    it("Should update the activated bonus via transferFrom", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");

      const balance = await PTokenA.scaledBalanceOf(lender.address);
      const transferAmount = balance.div("2");
      await PTokenA.connect(lender).approve(user.address, MaxUint256);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);
      const [currentIncome, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);

      await PTokenA.connect(user).transferFrom(lender.address, user.address, transferAmount);

      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await InterestIncreaser.getBonus(
        lender.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(currentIncome);
    });
    it("Should correctly update the activated bonus via transferFrom to itself", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");

      const balance = await PTokenA.scaledBalanceOf(lender.address);
      const transferAmount = balance.div("2");
      await PTokenA.connect(lender).approve(user.address, MaxUint256);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);
      const [currentIncome, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);

      await PTokenA.connect(user).transferFrom(lender.address, lender.address, transferAmount);

      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await InterestIncreaser.getBonus(
        lender.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(currentIncome);
    });
    it("Should update the activated bonus via mint", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");

      const balance = await PTokenA.scaledBalanceOf(lender.address);
      await testTokenA.mint(lender.address, parseUnits("1", decimalsA));
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);

      const lenderAmount = parseUnits("1", decimalsA);
      const lenderAmountInWad = lenderAmount.mul(multiplierA);
      const amountBOut = await getAmountsOut(dex, lenderAmount, [testTokenA.address, testTokenB.address]);
      const amountBOutInWadDecimals = amountBOut.mul(multiplierB);
      const limitPriceInWadDecimals = wadDiv(amountBOutInWadDecimals.toString(), lenderAmountInWad.toString()).toString();
      const limitPrice = BigNumber.from(limitPriceInWadDecimals).div(multiplierB);
      await PriceFeed.setAnswer(limitPrice);

      const [currentIncome, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);
      // mint via bucket
      await Bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await InterestIncreaser.getBonus(
        lender.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(currentIncome);
    });
    it("Should update the activated bonus via burn", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");
      const balance = await PTokenA.scaledBalanceOf(lender.address);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);
      const [currentIncome, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);
      // burn via bucket
      await Bucket.connect(lender).withdraw(lender.address, parseUnits("1", decimalsA));

      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await InterestIncreaser.getBonus(
        lender.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(currentIncome);
    });
    it("Should claim and transfer pTokens", async function () {
      await PrimexNft.connect(lender).activate(mintParams.id, "bucket1");

      await testTokenA.mint(user.address, parseUnits("1", decimalsA));
      await testTokenA.connect(user).approve(Bucket.address, MaxUint256);
      await Bucket.connect(user)["deposit(address,uint256,bool)"](user.address, parseUnits("1", decimalsA), true);
      await PTokenA.connect(user).transfer(Reserve.address, parseUnits("1", decimalsA));
      const balance = await PTokenA.scaledBalanceOf(lender.address);
      const reserveBalance = await PTokenA.scaledBalanceOf(Reserve.address);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await InterestIncreaser.getBonus(lender.address, mintParams.id);
      const [currentIncome, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore);
      const scaledAmount = rayDiv(accumulatedAmount, currentIncome).toString();
      await InterestIncreaser.connect(lender).claim(accumulatedAmount, mintParams.id);
      expect(await PTokenA.scaledBalanceOf(lender.address)).to.be.equal(balance.add(scaledAmount));
      expect(await PTokenA.scaledBalanceOf(Reserve.address)).to.be.equal(reserveBalance.sub(scaledAmount));
      expect((await InterestIncreaser.getBonus(lender.address, mintParams.id)).claimedAmount).to.be.equal(accumulatedAmount);
    });
  });
  describe("FeeDecreaser", function () {
    let snapshotId;
    let mintParams, sig;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
      mintParams = {
        bonusTypeId: 2,
        tier: 1,
        chainId: network.config.chainId,
        id: 76,
        recipient: trader.address,
        uris: uris,
      };
      uris = ["primexURL/" + "76" + "0", "primexURL/" + "76" + "1"];
      mintParams.uris = uris;
      sig = await signNftMintData(deployer, mintParams);
      await PrimexNft.connect(trader)["mint(bytes,(uint256,uint256,uint256,uint256,address,string[]))"](sig, mintParams);
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should activate nft both in the Nft and in the BonusExecutor contract", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await PrimexNft.connect(trader).activate(mintParams.id, "bucket1");
      const expectActivatedBonus = [
        BigNumber.from(mintParams.id),
        Bucket.address,
        percent,
        maxAmount,
        BigNumber.from(0),
        await Bucket.getNormalizedVariableDebt(),
        BigNumber.from(timestamp).add(deadline).add(1),
        BigNumber.from(0),
      ];
      const activatedBonus = await FeeDecreaser.getBonus(trader.address, mintParams.id);
      expect(activatedBonus).to.deep.equal(expectActivatedBonus);
      expect((await PrimexNft.getNft(mintParams.id)).activatedBy).to.be.equal(trader.address);
      expect((await PrimexNft.getNft(mintParams.id)).uri).to.be.equal(uris[1]);
    });
    it("Should update the activated bonus via mint", async function () {
      const borrowedAmount = parseUnits("5", decimalsA);
      const depositAmount = parseUnits("3", decimalsA);

      const swapAmount = borrowedAmount.add(depositAmount);
      const swap = swapAmount.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapAmount, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await PrimexNft.connect(trader).activate(mintParams.id, "bucket1");
      const balance = await DebtTokenA.scaledBalanceOf(trader.address);

      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await FeeDecreaser.getBonus(trader.address, mintParams.id);
      const [, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore, 50, false);
      // mint via open position
      await PositionManager.connect(trader).openPosition({
        marginParams: {
          bucket: "bucket1",
          borrowedAmount: borrowedAmount,
          depositInThirdAssetMegaRoutes: [],
        },
        firstAssetMegaRoutes: firstAssetRoutes,
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: 0,
        deadline: Math.round(new Date().getTime() / 1000) + 600,
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
      });

      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await FeeDecreaser.getBonus(
        trader.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(await Bucket.getNormalizedVariableDebt());
    });
    it("Should update the activated bonus via burn", async function () {
      await PrimexNft.connect(trader).activate(mintParams.id, "bucket1");

      const balance = await DebtTokenA.scaledBalanceOf(trader.address);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await FeeDecreaser.getBonus(trader.address, mintParams.id);
      const [, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore, 50, false);

      // burn via close position
      await PositionManager.connect(trader).partiallyClosePosition(
        0,
        parseUnits("0.5", decimalsB),
        trader.address,
        await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex),
        0,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd(testTokenB),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        getEncodedChainlinkRouteViaUsd(testTokenA),
        [],
        [],
      );
      const { accumulatedAmount: accumulatedAfter, lastUpdatedIndex: lastUpdatedIndexAfter } = await FeeDecreaser.getBonus(
        trader.address,
        mintParams.id,
      );
      expect(accumulatedAfter).to.be.equal(accumulatedAmount);
      expect(lastUpdatedIndexAfter).to.be.equal(await Bucket.getNormalizedVariableDebt());
    });

    it("Should  the activated bonus via burn", async function () {
      await PrimexNft.connect(trader).activate(mintParams.id, "bucket1");

      const balance = await DebtTokenA.scaledBalanceOf(trader.address);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await FeeDecreaser.getBonus(trader.address, mintParams.id);

      const [, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore, 50, false);
      // mine 1 block because _increaseAccumulatedAmount calculate accumulatedAmount for next block
      await provider.send("evm_mine");

      const contractAccumulatedAmount = await FeeDecreaser.getAccumulatedAmount(trader.address, mintParams.id);
      expect(contractAccumulatedAmount).to.be.equal(accumulatedAmount);
    });
    it("Should claim and transfer pTokens", async function () {
      await PrimexNft.connect(trader).activate(mintParams.id, "bucket1");

      await testTokenA.mint(user.address, parseUnits("1", decimalsA));
      await testTokenA.connect(user).approve(Bucket.address, MaxUint256);
      await Bucket.connect(user)["deposit(address,uint256,bool)"](user.address, parseUnits("1", decimalsA), true);
      await PTokenA.connect(user).transfer(Reserve.address, parseUnits("1", decimalsA));

      const balance = await DebtTokenA.scaledBalanceOf(trader.address);
      const reserveBalance = await PTokenA.scaledBalanceOf(Reserve.address);
      const { lastUpdatedIndex: lastUpdatedIndexBefore } = await FeeDecreaser.getBonus(trader.address, mintParams.id);
      const [, accumulatedAmount] = await _increaseAccumulatedAmount(balance, lastUpdatedIndexBefore, 50, false);
      await FeeDecreaser.connect(trader).claim(accumulatedAmount, mintParams.id);
      const scaledAmount = rayDiv(accumulatedAmount, (await Bucket.getNormalizedIncome()).toString()).toString();
      expect(await PTokenA.scaledBalanceOf(trader.address)).to.be.equal(scaledAmount);
      expect(await PTokenA.scaledBalanceOf(Reserve.address)).to.be.equal(reserveBalance.sub(scaledAmount));
      expect((await FeeDecreaser.getBonus(trader.address, mintParams.id)).claimedAmount).to.be.equal(accumulatedAmount);
    });
  });
});
