// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    provider,
    BigNumber,
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseUnits, parseEther, keccak256, toUtf8Bytes },
    constants: { NegativeOne },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockERC20 } = require("../utils/waffleMocks");
const { addLiquidity, checkIsDexSupported, getAmountsOut, getSingleMegaRoute } = require("../utils/dexOperations");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const { wadMul, wadDiv } = require("../utils/math");
const { eventValidation } = require("../utils/eventValidation");
const { calculateFeeInPaymentAsset, calculateFeeAmountInPmx } = require("../utils/protocolUtils");
const {
  FeeRateType,
  NATIVE_CURRENCY,
  MAX_TOKEN_DECIMALITY,
  USD_DECIMALS,
  USD_MULTIPLIER,
  UpdatePullOracle,
} = require("../utils/constants");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  setOraclePrice,
  getEncodedChainlinkRouteViaUsd,
} = require("../utils/oracleUtils");
process.env.TEST = true;

describe("SwapManager_integration", function () {
  let dex, testTokenA, testTokenB, PMXToken;
  let Treasury, PrimexDNS, swapManager, traderBalanceVault, priceOracle, mockContract, WhiteBlackList, keeperRD;
  let deployer, trader;
  let decimalsA, decimalsB;
  let ErrorsLibrary;
  const defaultTier = 0;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());
    ErrorsLibrary = await getContract("Errors");
    traderBalanceVault = await getContract("TraderBalanceVault");
    Treasury = await getContract("Treasury");
    PrimexDNS = await getContract("PrimexDNS");
    priceOracle = await getContract("PriceOracle");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PMXToken = await getContract("EPMXToken");
    WhiteBlackList = await getContract("WhiteBlackList");
    swapManager = await getContract("SwapManager");
    keeperRD = await getContract("KeeperRewardDistributor");
    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);
    await testTokenA.connect(trader).approve(swapManager.address, parseUnits("100", decimalsA));

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
  });

  describe("swap", function () {
    let amountToConvert, amountOut, price, swapParams, amountOutAfterFee, feeInPositionAsset, feeAmountInPmx;
    let snapshotId;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      amountToConvert = parseUnits("2", decimalsA);
      amountOut = await getAmountsOut(dex, amountToConvert, [testTokenA.address, testTokenB.address]);

      const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH
      await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
      await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

      feeInPositionAsset = await calculateFeeInPaymentAsset(
        testTokenB.address,
        amountOut,
        FeeRateType.SwapMarketOrder,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenB),
      );
      amountOutAfterFee = amountOut.sub(feeInPositionAsset);

      const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
      const feeInPositonAssetWithDiscount = wadMul(feeInPositionAsset.toString(), pmxDiscountMultiplier.toString()).toString();

      feeAmountInPmx = await calculateFeeAmountInPmx(
        testTokenB.address,
        PMXToken.address,
        feeInPositonAssetWithDiscount,
        await getEncodedChainlinkRouteViaUsd(PMXToken),
      );

      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

      const swap = amountToConvert.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, amountToConvert, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);
    });
    beforeEach(async function () {
      swapParams = {
        tokenA: testTokenA.address,
        tokenB: testTokenB.address,
        amountTokenA: amountToConvert,
        amountOutMin: 0,
        megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
        receiver: trader.address,
        deadline: new Date().getTime() + 600,
        isSwapFromWallet: true,
        isSwapToWallet: true,
        isSwapFeeInPmx: false,
        tokenAtokenBOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
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
    it("Should revert if the swapManager is paused", async function () {
      await swapManager.pause();
      await expect(swapManager.connect(trader).callStatic.swap(swapParams, 0, false)).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert if the msg.sender is on the blacklist", async function () {
      await WhiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(swapManager.connect(mockContract).callStatic.swap(swapParams, 0, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });

    it("Should revert if amountOutMin more than amountOut", async function () {
      const params = { ...swapParams, amountOutMin: amountOut.add(1) };
      await expect(swapManager.connect(trader).callStatic.swap(params, 0, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SLIPPAGE_TOLERANCE_EXCEEDED",
      );
    });

    it("Should revert if tokenA is NATIVE_CURRENCY", async function () {
      const params = { ...swapParams, tokenA: NATIVE_CURRENCY, isSwapFromWallet: false };
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
        value: parseEther("30"),
      });
      await expect(
        swapManager.connect(trader).callStatic.swap(params, 0, false, {
          value: amountToConvert,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NATIVE_CURRENCY_CANNOT_BE_ASSET");
    });

    it("Should swap from user wallet and return correct value", async function () {
      const actualAmount = await swapManager.connect(trader).callStatic.swap(swapParams, 0, false);
      expect(actualAmount).to.be.equal(amountOutAfterFee);
    });

    it("Should swap from user wallet and emit SpotSwap event", async function () {
      const tx = await swapManager.connect(trader).swap(swapParams, 0, false);

      const epxectedSpotSwap = {
        trader: trader.address,
        receiver: swapParams.receiver,
        tokenA: swapParams.tokenA,
        tokenB: swapParams.tokenB,
        amountSold: swapParams.amountTokenA,
        amountBought: amountOutAfterFee,
      };
      const expectedPaidProtocolFee = {
        trader: trader.address,
        boughtAsset: swapParams.tokenB,
        feeRateType: FeeRateType.SwapMarketOrder,
        feeInPositionAsset: feeInPositionAsset,
        feeInPmx: 0,
      };

      eventValidation("SpotSwap", await tx.wait(), epxectedSpotSwap);
      eventValidation("PaidProtocolFee", await tx.wait(), expectedPaidProtocolFee);
    });

    it("Should swap and increase balance of receiver", async function () {
      await expect(() => swapManager.connect(trader).swap(swapParams, 0, false)).to.changeTokenBalance(
        testTokenB,
        trader,
        amountOutAfterFee,
      );
    });

    it("Should not take fee when user has NO_FEE_ROLE", async function () {
      const dexAdapter = await getContract("DexAdapter");
      const registryAddress = await dexAdapter.registry();
      const registry = await getContractAt("PrimexRegistry", registryAddress);
      const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
      await registry.grantRole(NO_FEE_ROLE, trader.address);

      await expect(() => swapManager.connect(trader).swap(swapParams, 0, false)).to.changeTokenBalance(
        testTokenA,
        trader,
        amountToConvert.mul(NegativeOne),
      );
    });
    it("Should update pyth oracle via swap function", async function () {
      const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
      const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
      const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
      const pyth = await getContract("MockPyth");
      await PrimexDNS.setProtocolFeeRate([[FeeRateType.SwapMarketOrder, defaultTier, parseEther("0.001")]]);

      await priceOracle.updatePythPairId([PMXToken.address, testTokenB.address, await priceOracle.eth()], [PMXID, tokenBID, nativeID]);
      // price in 10**8
      const expo = -8;
      const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

      const timeStamp = (await provider.getBlock("latest")).timestamp;
      const updateDataPmx = await pyth.createPriceFeedUpdateData(
        PMXID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataB = await pyth.createPriceFeedUpdateData(
        tokenBID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataNative = await pyth.createPriceFeedUpdateData(
        nativeID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      swapParams.pullOracleData = [[updateDataPmx, updateDataB, updateDataNative]];
      swapParams.pullOracleTypes = [UpdatePullOracle.Pyth];
      await swapManager.connect(trader).swap(swapParams, parseEther("0.001"), false, { value: 3 });
      const pricePmx = await pyth.getPrice(PMXID);
      const priceB = await pyth.getPrice(tokenBID);
      const priceNative = await pyth.getPrice(nativeID);
      expect(pricePmx.publishTime).to.be.equal(priceB.publishTime).to.be.equal(priceNative.publishTime).to.be.equal(timeStamp);
      expect(pricePmx.price).to.be.equal(priceB.price).to.be.equal(priceNative.price).to.be.equal(price);
    });

    it("Should check the tolerable limit when the sender has NO_FEE_ROLE", async function () {
      const dexAdapter = await getContract("DexAdapter");
      const registryAddress = await dexAdapter.registry();
      const registry = await getContractAt("PrimexRegistry", registryAddress);
      const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
      await registry.grantRole(NO_FEE_ROLE, trader.address);
      await setOraclePrice(testTokenA, testTokenB, price.mul("2"));
      await expect(swapManager.connect(trader).swap(swapParams, parseEther("0.001"), true)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should receive swap to user balance in protocol", async function () {
      const params = { ...swapParams, isSwapToWallet: false };
      const { availableBalance: userBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);

      const tx = await swapManager.connect(trader).swap(params, 0, false);
      await tx.wait();

      const { availableBalance: userBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenB.address);
      expect(userBalanceAfter).equal(userBalanceBefore.add(amountOutAfterFee));
    });

    it("Should swap and send fee to the treasury", async function () {
      await expect(() => swapManager.connect(trader).swap(swapParams, 0, false)).to.changeTokenBalance(
        testTokenB,
        Treasury,
        feeInPositionAsset,
      );
    });

    it("Should revert when user has not enough balance in protocol", async function () {
      const params = { ...swapParams, isSwapFromWallet: false };
      await expect(swapManager.connect(trader).swap(params, 0, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );
    });

    it("Should swap from user balance in protocol", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapToWallet: false };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      const { availableBalance: userBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      const { availableBalance: tokenBBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalance(
        testTokenB,
        Treasury,
        feeInPositionAsset,
      );

      const { availableBalance: userBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      const { availableBalance: tokenBBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenB.address);
      expect(userBalanceBefore.sub(amountToConvert)).equal(userBalanceAfter);
      expect(tokenBBalanceBefore.add(amountOutAfterFee)).equal(tokenBBalanceAfter);
    });

    it("Should revert when isSwapFeeInPmx is true & when trader balance in PMX in traderBalanceVault is smaller then feeAmountInPmx", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapFeeInPmx: true };
      await expect(swapManager.connect(trader).swap(params, 0, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );
    });

    it("Should swap and the treasury receive fee amount in PMX when isProtocolFeeInPmx is true", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapFeeInPmx: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

      const { availableBalance: availablePmxBalanceBefore } = await traderBalanceVault.balances(trader.address, PMXToken.address);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalances(
        PMXToken,
        [traderBalanceVault, Treasury],
        [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
      );

      const { availableBalance: availablePmxBalanceAfter } = await traderBalanceVault.balances(trader.address, PMXToken.address);
      expect(availablePmxBalanceBefore.sub(availablePmxBalanceAfter)).equal(feeAmountInPmx);
    });

    it("Should swap and should increase treasury balance by fee amount in PMX when isProtocolFeeInPmx and isSwapFromWallet is true", async function () {
      const params = { ...swapParams, isSwapFromWallet: true, isSwapFeeInPmx: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalances(
        PMXToken,
        [traderBalanceVault.address, Treasury],
        [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
      );
    });

    it("Should swap and should not increase treasury balance if protocolFeeRate = 0 and fee in PMX", async function () {
      await PrimexDNS.setProtocolFeeRate([[FeeRateType.SwapMarketOrder, defaultTier, 0]]);
      expect(await PrimexDNS.protocolFeeRates(FeeRateType.SwapMarketOrder)).to.equal(0);

      const params = { ...swapParams, isSwapFromWallet: true, isSwapFeeInPmx: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

      const treasuryBalanceBeforeSwap = await PMXToken.balanceOf(Treasury.address);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalance(testTokenB, trader, amountOut);
      const treasuryBalanceAfterSwap = await PMXToken.balanceOf(Treasury.address);
      expect(treasuryBalanceBeforeSwap).to.equal(treasuryBalanceAfterSwap);
    });
    describe("swapInLimitOrder", function () {
      let SwapInLimitOrderParams;
      before(async function () {
        SwapInLimitOrderParams = {
          depositAsset: testTokenA.address,
          positionAsset: testTokenB.address,
          depositAmount: amountToConvert,
          megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
          trader: trader.address,
          deadline: new Date().getTime() + 600,
          feeToken: testTokenB.address,
          keeperRewardDistributor: keeperRD.address,
          gasSpent: 0,
          depositPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
          pmxPositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
          nativePositionAssetOracleData: await getEncodedChainlinkRouteViaUsd(testTokenB),
        };
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
      it("Should revert if the swapManager is paused", async function () {
        await swapManager.pause();
        await expect(swapManager.callStatic.swapInLimitOrder(SwapInLimitOrderParams, 0)).to.be.revertedWith("Pausable: paused");
      });
      it("Should revert if caller is not LOM_ROLE", async function () {
        await expect(swapManager.connect(trader).callStatic.swapInLimitOrder(SwapInLimitOrderParams, 0)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });
  });
});
