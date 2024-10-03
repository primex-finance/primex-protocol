// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getContractAt,
    getContractFactory,
    getContract,
    getNamedSigners,
    constants: { MaxUint256, Zero, NegativeOne },
    utils: { parseEther, parseUnits },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const {
  getAmountsOut,
  addLiquidity,
  checkIsDexSupported,
  swapExactTokensForTokens,
  getSingleMegaRoute,
} = require("../utils/dexOperations");
const { wadDiv, wadMul } = require("../utils/math");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
const { MAX_TOKEN_DECIMALITY, USD_DECIMALS, USD_MULTIPLIER } = require("../utils/constants");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("../utils/oracleUtils");

process.env.TEST = true;

async function openPosition(testTokenA, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes) {
  const decimalsA = await testTokenA.decimals();
  const decimalsB = await testTokenB.decimals();
  const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
  const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

  const { trader, lender } = await getNamedSigners();
  const lenderAmount = parseUnits("50", decimalsA);
  const depositAmount = parseUnits("20", decimalsA);

  await testTokenA.connect(trader).approve(positionManager.address, MaxUint256);
  await testTokenA.connect(lender).approve(bucket.address, MaxUint256);

  await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

  const borrowedAmount = parseUnits("30", decimalsA);
  const amountOutMin = 0;
  const deadline = new Date().getTime() + 600;
  const takeDepositFromWallet = true;

  const swapSize = depositAmount.add(borrowedAmount);
  const swap = swapSize.mul(multiplierA);
  const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
  const amountB = amount0Out.mul(multiplierB);
  const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
  const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
  await setOraclePrice(testTokenA, testTokenB, price);

  const tx = await positionManager.connect(trader).openPosition({
    marginParams: {
      bucket: "bucket1",
      borrowedAmount: borrowedAmount,
      depositInThirdAssetMegaRoutes: [],
    },
    firstAssetMegaRoutes: assetRoutes,
    depositAsset: testTokenA.address,
    depositAmount: depositAmount,
    positionAsset: testTokenB.address,
    amountOutMin: amountOutMin,
    deadline: deadline,
    takeDepositFromWallet: takeDepositFromWallet,
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
  await tx.wait();
  const positionsId = await positionManager.positionsId();
  return positionsId.sub(1);
}

async function closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose) {
  const decimalsA = await testTokenA.decimals();
  const decimalsB = await testTokenB.decimals();
  const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
  const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

  const { trader } = await getNamedSigners();
  const { positionAmount } = await positionManager.getPosition(positionId);
  const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
  const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
  const amount0OutInWadDecimals = amount0Out.mul(multiplierA);

  let price = wadDiv(positionAmountInWadDecimals.toString(), amount0OutInWadDecimals.toString()).toString();
  price = BigNumber.from(price).div(USD_MULTIPLIER);
  await setOraclePrice(testTokenA, testTokenB, price);

  await positionManager
    .connect(trader)
    .closePosition(
      positionId,
      trader.address,
      assetRoutesForClose,
      0,
      getEncodedChainlinkRouteViaUsd(testTokenA),
      getEncodedChainlinkRouteViaUsd(testTokenB),
      getEncodedChainlinkRouteViaUsd(testTokenB),
      [],
      [],
    );
}

describe("Reserve_integration", function () {
  let bucket, bucketAddress;
  let reserve, reserveAddress;
  let pToken, pTokenAddress;
  let testTokenA, testTokenB;
  let dex;
  let priceFeed, priceOracle;
  let PrimexDNS;
  let positionManager;
  let assetRoutes, assetRoutesForClose;
  let snapshotIdBase;
  let decimalsA, decimalsB;
  let ErrorsLibrary;
  let ttaPriceInETH;

  before(async function () {
    await fixture(["Test"]);
    const { trader } = await getNamedSigners();
    ErrorsLibrary = await getContract("Errors");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100000", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();

    PrimexDNS = await getContract("PrimexDNS");
    positionManager = await getContract("PositionManager");

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }
    checkIsDexSupported(dex);
    assetRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);
    assetRoutesForClose = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    priceOracle = await getContract("PriceOracle");
    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    reserveAddress = await bucket.reserve();
    reserve = await getContractAt("Reserve", reserveAddress);

    pTokenAddress = await bucket.pToken();
    pToken = await getContractAt("PToken", pTokenAddress);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotIdBase],
    });
  });

  describe("paybackPermanentLoss() called with a Primex Bucket as a param", function () {
    it("Should revert if permanentLoss is 0", async function () {
      const positionId = await openPosition(testTokenA, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes);

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

      expect(await bucket.permanentLoss()).to.equal(Zero);
      await expect(reserve.paybackPermanentLoss(bucket.address)).to.be.revertedWithCustomError(ErrorsLibrary, "BURN_AMOUNT_IS_ZERO");
    });

    it("Should emit BurnAmountCalculated event with an arg 'burnAmount'", async function () {
      const positionId = await openPosition(testTokenA, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      for (let i = 0; i < 300; i++) {
        await network.provider.send("evm_mine");
      }

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

      const permanentLoss = await bucket.permanentLoss();
      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      const amount = permanentLoss.lte(pTokenBalance) ? permanentLoss : pTokenBalance;

      await expect(reserve.paybackPermanentLoss(bucket.address)).to.emit(reserve, "BurnAmountCalculated").withArgs(amount);
    });

    it("Should emit Burn event when pTokens were burned", async function () {
      const positionId = await openPosition(testTokenA, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      for (let i = 0; i < 300; i++) {
        await network.provider.send("evm_mine");
      }

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

      const permanentLoss = await bucket.permanentLoss();
      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      const amount = permanentLoss.lte(pTokenBalance) ? permanentLoss : pTokenBalance;

      await expect(reserve.paybackPermanentLoss(bucket.address)).to.emit(pToken, "Burn").withArgs(reserve.address, amount);
    });
  });

  describe("paybackPermanentLoss() called with an Attacker Bucket as a param ", function () {
    let attacker;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      // Create a contract that supports interface IBucket
      const attackerFactory = await getContractFactory("AttackerBucket");
      attacker = await attackerFactory.deploy();
      await attacker.deployed();

      // Set pToken of another bucket to pToken field of this contract
      const primexDNS = await getContract("PrimexDNS");
      const bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;
      const bucket = await getContractAt("Bucket", bucketAddress);
      const bucketPtoken = await bucket.pToken();

      await attacker.setPTokenAddress(bucketPtoken);
      const attackerPtoken = await attacker.pToken();
      expect(attackerPtoken).to.equal(bucketPtoken);

      // make ptoken balance is not zero
      const positionId = await openPosition(testTokenA, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);
    });

    it("Should revert if attacker bucket address is not one of dnsBucket", async function () {
      const bucketName = await bucket.name();
      await attacker.setName(bucketName);

      expect(await attacker.name()).to.equal(bucketName);

      await expect(reserve.paybackPermanentLoss(attacker.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_PRIMEX_BUCKET",
      );
    });
  });

  describe("transferToTreasury", function () {
    let treasury, snapshotId;
    beforeEach(async function () {
      treasury = await getContract("Treasury");
      const positionId = await openPosition(testTokenA, bucket, priceFeed, positionManager, dex, testTokenB, assetRoutes);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      for (let i = 0; i < 300; i++) {
        await network.provider.send("evm_mine");
      }
      await closePosition(positionId, positionManager, dex, testTokenA, testTokenB, priceFeed, assetRoutesForClose);

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

    it("Should revert if Reserve balance is not sufficient", async function () {
      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      await expect(reserve.transferToTreasury(bucket.address, pTokenBalance.add(1))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NOT_SUFFICIENT_RESERVE_BALANCE",
      );
    });

    it("Should calculate amount to be left from pToken.totalSupply", async function () {
      const transferRestrictions = {
        minAmountToBeLeft: BigNumber.from(0),
        minPercentOfTotalSupplyToBeLeft: parseEther("0.000001"),
      };
      await reserve.setTransferRestrictions(pTokenAddress, transferRestrictions);

      const reserveBalance = await pToken.balanceOf(reserveAddress);
      const totalSupply = await pToken.totalSupply();
      const scaledTotalSupply = await pToken.scaledTotalSupply();
      expect(scaledTotalSupply).to.be.lt(totalSupply);

      const percentFromTotalSupply = wadMul(
        totalSupply.toString(),
        transferRestrictions.minPercentOfTotalSupplyToBeLeft.toString(),
      ).toString();
      const percentFromScaledSupply = wadMul(
        scaledTotalSupply.toString(),
        transferRestrictions.minPercentOfTotalSupplyToBeLeft.toString(),
      ).toString();
      expect(BigNumber.from(percentFromScaledSupply)).to.be.lt(BigNumber.from(percentFromTotalSupply));

      const amountAllowed = reserveBalance.sub(BigNumber.from(percentFromTotalSupply));
      const amountBanned = reserveBalance.sub(BigNumber.from(percentFromScaledSupply));
      expect(amountAllowed).to.be.lt(amountBanned);

      await expect(reserve.transferToTreasury(bucket.address, amountBanned)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NOT_SUFFICIENT_RESERVE_BALANCE",
      );

      await expect(reserve.transferToTreasury(bucket.address, amountAllowed.add(1))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NOT_SUFFICIENT_RESERVE_BALANCE",
      );

      await expect(reserve.transferToTreasury(bucket.address, amountAllowed))
        .to.emit(reserve, "TransferFromReserve")
        .withArgs(pTokenAddress, treasury.address, amountAllowed);
    });

    it("Should revert if Reserve balance is not sufficient by minPercentOfTotalSupplyToBeLeft", async function () {
      const transferRestrictions = {
        minAmountToBeLeft: BigNumber.from(0),
        minPercentOfTotalSupplyToBeLeft: parseEther("0.1"),
      };
      await reserve.setTransferRestrictions(pTokenAddress, transferRestrictions);
      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      await expect(reserve.transferToTreasury(bucket.address, pTokenBalance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NOT_SUFFICIENT_RESERVE_BALANCE",
      );
    });

    it("Should revert if Reserve balance is not sufficient by minAmountToBeLeft", async function () {
      const transferRestrictions = {
        minAmountToBeLeft: parseUnits("1", decimalsA),
        minPercentOfTotalSupplyToBeLeft: BigNumber.from(0),
      };
      await reserve.setTransferRestrictions(pTokenAddress, transferRestrictions);

      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      await expect(reserve.transferToTreasury(bucket.address, pTokenBalance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NOT_SUFFICIENT_RESERVE_BALANCE",
      );
    });

    it("Should emit TransferFromReserve event when transfer is successful", async function () {
      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      await expect(reserve.transferToTreasury(bucket.address, pTokenBalance))
        .to.emit(reserve, "TransferFromReserve")
        .withArgs(pTokenAddress, treasury.address, pTokenBalance);
    });

    it("Should increase Treasury balance and decrease Bucket balance when transfer is successful", async function () {
      const pTokenBalance = await pToken.balanceOf(reserveAddress);
      await expect(() => reserve.transferToTreasury(bucket.address, pTokenBalance)).to.changeTokenBalances(
        testTokenA,
        [bucket, treasury],
        [pTokenBalance.mul(NegativeOne), pTokenBalance],
      );
    });

    it("Should burn pTokens on Reserve balance when transfer is successful", async function () {
      const pTokenBalance = await pToken.balanceOf(reserveAddress);

      await expect(() => reserve.transferToTreasury(bucket.address, pTokenBalance)).to.changeTokenBalance(
        pToken,
        reserve,
        pTokenBalance.mul(NegativeOne),
      );
    });
  });
});
