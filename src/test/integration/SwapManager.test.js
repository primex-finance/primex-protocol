// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    provider,
    BigNumber,
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseUnits, parseEther, keccak256, toUtf8Bytes },
    constants: { NegativeOne },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockERC20 } = require("../utils/waffleMocks");
const { addLiquidity, checkIsDexSupported, getAmountsOut, getSingleRoute } = require("../utils/dexOperations");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const { wadMul, wadDiv } = require("../utils/math");
const { eventValidation } = require("../utils/eventValidation");
const { OrderType, NATIVE_CURRENCY, MAX_TOKEN_DECIMALITY } = require("../utils/constants");
const { calculateMinMaxFeeInFeeToken } = require("../utils/protocolFeeUtils");

process.env.TEST = true;

describe("SwapManager_integration", function () {
  let dex, testTokenA, testTokenB, PMXToken, priceFeed;
  let Treasury, PrimexDNS, swapManager, traderBalanceVault, priceOracle, mockContract, WhiteBlackList;
  let deployer, trader;
  let decimalsA, decimalsB;
  let ErrorsLibrary;

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
    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);
    await testTokenA.connect(trader).approve(swapManager.address, parseUnits("100", decimalsA));
    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
  });

  describe("swap", function () {
    let amountToConvert, amountOut, feeAmountInPmx, feeAmountInEth, swapParams, swapRate, swapRateInPmx;
    let snapshotId;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      amountToConvert = parseUnits("2", decimalsA);
      amountOut = await getAmountsOut(dex, amountToConvert, [testTokenA.address, testTokenB.address]);

      const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
      const priceFeedTTAPMX = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_PMX", deployer.address);
      const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
      const decimalsPMX = await PMXToken.decimals();
      await priceFeedTTAPMX.setDecimals(decimalsPMX);
      await priceFeedTTAETH.setDecimals("18");
      const ttaPriceInPMX = parseUnits("0.2", decimalsPMX); // 1 tta=0.2 pmx
      const ttaPriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
      await priceFeedTTAPMX.setAnswer(ttaPriceInPMX);
      await priceFeedTTAETH.setAnswer(ttaPriceInETH);
      await priceOracle.updatePriceFeed(testTokenA.address, PMXToken.address, priceFeedTTAPMX.address);
      await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);

      // need to calculate minFee and maxFee from native to PMX
      const priceFeedETHPMX = await PrimexAggregatorV3TestServiceFactory.deploy("ETH_PMX", deployer.address);
      // 1 tta=0.2 pmx; 1 tta=0.3 eth -> 1 eth = 0.2/0.3 pmx
      await priceFeedETHPMX.setAnswer(parseUnits("0.666666666666666666", 18));
      await priceFeedETHPMX.setDecimals(decimalsPMX);
      await priceOracle.updatePriceFeed(await priceOracle.eth(), PMXToken.address, priceFeedETHPMX.address);

      const multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
      const multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

      swapRate = await PrimexDNS.feeRates(OrderType.SWAP_MARKET_ORDER, NATIVE_CURRENCY);
      swapRateInPmx = await PrimexDNS.feeRates(OrderType.SWAP_MARKET_ORDER, PMXToken.address);

      const feeAmountCalculateWithPMXRate = wadMul(amountToConvert.toString(), swapRateInPmx.toString()).toString();
      const feeAmountCalculateWithETHRate = wadMul(amountToConvert.toString(), swapRate.toString()).toString();
      feeAmountInPmx = wadMul(
        BigNumber.from(feeAmountCalculateWithPMXRate).mul(multiplierA).toString(),
        ttaPriceInPMX.toString(),
      ).toString();
      feeAmountInEth = wadMul(
        BigNumber.from(feeAmountCalculateWithETHRate).mul(multiplierA).toString(),
        ttaPriceInETH.toString(),
      ).toString();

      swapParams = {
        tokenA: testTokenA.address,
        tokenB: testTokenB.address,
        amountTokenA: amountToConvert,
        amountOutMin: 0,
        routes: await getSingleRoute([testTokenA.address, testTokenB.address], dex),
        receiver: trader.address,
        deadline: new Date().getTime() + 600,
        isSwapFromWallet: true,
        isSwapToWallet: true,
        isSwapFeeInPmx: false,
        payFeeFromWallet: true,
      };

      const swap = amountToConvert.mul(multiplierA);
      const positionAmount = await getAmountsOut(dex, amountToConvert, [testTokenA.address, testTokenB.address]);
      const amountB = positionAmount.mul(multiplierB);
      const price0 = wadDiv(swap.toString(), amountB.toString()).toString();
      const price = BigNumber.from(price0).div(multiplierA);
      await priceFeed.setAnswer(price);
      await priceFeed.setDecimals(await testTokenB.decimals());
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
      await expect(
        swapManager.connect(trader).callStatic.swap(swapParams, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert if the msg.sender is on the blacklist", async function () {
      await WhiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        swapManager.connect(mockContract).callStatic.swap(swapParams, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });

    it("Should revert if amountOutMin more than amountOut", async function () {
      const params = { ...swapParams, amountOutMin: amountOut.add(1) };
      await expect(
        swapManager.connect(trader).callStatic.swap(params, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
    });

    it("Should revert if tokenA is NATIVE_CURRENCY", async function () {
      const params = { ...swapParams, tokenA: NATIVE_CURRENCY, isSwapFromWallet: false };
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
        value: parseEther("30"),
      });
      await expect(
        swapManager.connect(trader).callStatic.swap(params, 0, false, {
          value: feeAmountInEth + amountToConvert,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "NATIVE_CURRENCY_CANNOT_BE_ASSET");
    });

    it("Should swap from user wallet and return correct value", async function () {
      const actualAmount = await swapManager.connect(trader).callStatic.swap(swapParams, 0, false, {
        value: feeAmountInEth,
      });
      expect(actualAmount).to.be.equal(amountOut);
    });

    it("Should swap from user wallet and emit SpotSwap event", async function () {
      const tx = await swapManager.connect(trader).swap(swapParams, 0, false, {
        value: feeAmountInEth,
      });

      const epxectedSpotSwap = {
        trader: trader.address,
        receiver: swapParams.receiver,
        tokenA: swapParams.tokenA,
        tokenB: swapParams.tokenB,
        amountSold: swapParams.amountTokenA,
        amountBought: amountOut,
      };
      eventValidation("SpotSwap", await tx.wait(), epxectedSpotSwap);
    });

    it("Should swap and increase balance of receiver", async function () {
      await expect(() =>
        swapManager.connect(trader).swap(swapParams, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.changeTokenBalance(testTokenB, trader, amountOut);
    });

    it("Should decrease user wallet balance by amount and increase treasury balance by feeAmountInEth when isSwapFromWallet is true", async function () {
      const treasuryBalanceBeforeSwap = await provider.getBalance(Treasury.address);
      await expect(() =>
        swapManager.connect(trader).swap(swapParams, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.changeTokenBalance(testTokenA, trader, amountToConvert.mul(NegativeOne));

      const treasuryBalanceAfterSwap = await provider.getBalance(Treasury.address);
      expect(treasuryBalanceAfterSwap).to.equal(treasuryBalanceBeforeSwap.add(feeAmountInEth));
    });

    it("Should return change to msg.sender in traderBalanceVault when msg.value > feeAmountInEth isSwapFromWallet is true", async function () {
      const senderBalanceBeforeSwap = await provider.getBalance(trader.address);
      const { lockedBalance: lockedBefore, availableBalance: availableBefore } = await traderBalanceVault.balances(
        trader.address,
        NATIVE_CURRENCY,
      );
      const tx = await swapManager.connect(trader).swap(swapParams, 0, false, {
        value: feeAmountInEth * 1.5,
      });
      const receipt = await tx.wait();
      const gasForTx = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const senderBalanceAfterSwap = await provider.getBalance(trader.address);
      expect(senderBalanceAfterSwap).to.equal(senderBalanceBeforeSwap.sub(feeAmountInEth * 1.5).sub(gasForTx));

      const { lockedBalance: lockedAfter, availableBalance: availableAfter } = await traderBalanceVault.balances(
        trader.address,
        NATIVE_CURRENCY,
      );
      expect(lockedAfter.sub(lockedBefore)).to.be.equal(0);
      expect(availableAfter.sub(availableBefore)).to.be.equal(feeAmountInEth * 0.5);
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
    it("Should check the tolerable limit when the sender has NO_FEE_ROLE", async function () {
      const dexAdapter = await getContract("DexAdapter");
      const registryAddress = await dexAdapter.registry();
      const registry = await getContractAt("PrimexRegistry", registryAddress);
      const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
      await registry.grantRole(NO_FEE_ROLE, trader.address);
      await expect(swapManager.connect(trader).swap(swapParams, parseEther("0.001"), true)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should receive swap to user balance in protocol", async function () {
      const params = { ...swapParams, isSwapToWallet: false };
      const { availableBalance: userBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);

      const tx = await swapManager.connect(trader).swap(params, 0, false, {
        value: feeAmountInEth,
      });
      await tx.wait();

      const { availableBalance: userBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenB.address);
      expect(userBalanceAfter).equal(userBalanceBefore.add(amountOut));
    });

    it("Should swap and send fee to the treasury", async function () {
      await expect(() =>
        swapManager.connect(trader).swap(swapParams, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.changeEtherBalances([trader, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);
    });

    it("Should swap and send minmal fee to the treasury", async function () {
      const minFee = BigNumber.from(feeAmountInEth).mul(2);
      await PrimexDNS.setFeeRestrictions(OrderType.SWAP_MARKET_ORDER, { minProtocolFee: minFee, maxProtocolFee: minFee.mul(2) });
      await expect(() =>
        swapManager.connect(trader).swap(swapParams, 0, false, {
          value: minFee,
        }),
      ).to.changeEtherBalances([trader, Treasury], [BigNumber.from(minFee).mul(NegativeOne), minFee]);
    });

    it("Should swap and send max fee to the treasury", async function () {
      const maxFee = BigNumber.from(feeAmountInEth).div(2);
      await PrimexDNS.setFeeRestrictions(OrderType.SWAP_MARKET_ORDER, { minProtocolFee: 0, maxProtocolFee: maxFee });
      await expect(() =>
        swapManager.connect(trader).swap(swapParams, 0, false, {
          value: maxFee,
        }),
      ).to.changeEtherBalances([trader, Treasury], [BigNumber.from(maxFee).mul(NegativeOne), maxFee]);
    });
    it("Should revert when user has not enough balance in protocol", async function () {
      const params = { ...swapParams, isSwapFromWallet: false };
      await expect(
        swapManager.connect(trader).swap(params, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_FREE_ASSETS");
    });

    it("Should swap from user balance in protocol", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapToWallet: false, payFeeFromWallet: false };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
        value: feeAmountInEth,
      });

      const { availableBalance: userBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      const { availableBalance: ethBalanceBefore } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeEtherBalances(
        [traderBalanceVault, Treasury],
        [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth],
      );

      const { availableBalance: userBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      const { availableBalance: ethBalanceAfter } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      expect(userBalanceBefore.sub(amountToConvert)).equal(userBalanceAfter);
      expect(ethBalanceBefore.sub(feeAmountInEth)).equal(ethBalanceAfter);
    });

    it("Should swap from user balance in protocol but get fee from another source", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapToWallet: false, payFeeFromWallet: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      const { availableBalance: userBalanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() =>
        swapManager.connect(trader).swap(params, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.changeEtherBalances([trader, Treasury], [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth]);

      const { availableBalance: userBalanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(userBalanceBefore.sub(amountToConvert)).equal(userBalanceAfter);
    });
    it("Should swap from user wallet but get fee from another source", async function () {
      const params = { ...swapParams, isSwapFromWallet: true, isSwapToWallet: false, payFeeFromWallet: false };
      await testTokenA.connect(trader).approve(swapManager.address, amountToConvert);

      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
        value: feeAmountInEth,
      });
      const { availableBalance: ethBalanceBefore } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeEtherBalances(
        [traderBalanceVault, Treasury],
        [BigNumber.from(feeAmountInEth).mul(NegativeOne), feeAmountInEth],
      );
      const { availableBalance: ethBalanceAfter } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      expect(ethBalanceBefore.sub(feeAmountInEth)).equal(ethBalanceAfter);
    });
    it("Should revert when isSwapFeeInPmx is true & when trader balance in PMX in traderBalanceVault is smaller then feeAmountInPmx", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapFeeInPmx: true, payFeeFromWallet: false };
      await expect(swapManager.connect(trader).swap(params, 0, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );
    });

    it("Should revert swap when isSwapFeeInPmx is true, isSwapFromWallet is true and msg.value more than zero", async function () {
      const params = { ...swapParams, isSwapFeeInPmx: true };

      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(swapManager.address, feeAmountInPmx);

      await expect(
        swapManager.connect(trader).swap(params, 0, false, {
          value: parseEther("1"),
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DISABLED_TRANSFER_NATIVE_CURRENCY");
    });

    it("Should revert swap when isSwapFeeInPmx is true, isSwapFromWallet is false and msg.value more than zero", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapFeeInPmx: true, payFeeFromWallet: false };

      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx);

      await expect(
        swapManager.connect(trader).swap(params, 0, false, {
          value: parseEther("1"),
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DISABLED_TRANSFER_NATIVE_CURRENCY");
    });

    it("Should swap and the treasury receive fee amount in PMX when isProtocolFeeInPmx is true", async function () {
      const params = { ...swapParams, isSwapFromWallet: false, isSwapFeeInPmx: true, payFeeFromWallet: false };
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
      await PMXToken.connect(trader).approve(swapManager.address, feeAmountInPmx);
      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalances(
        PMXToken,
        [trader.address, Treasury],
        [BigNumber.from(feeAmountInPmx).mul(NegativeOne), feeAmountInPmx],
      );
    });

    it("Should send minimal fee in PMX to treasury", async function () {
      const params = { ...swapParams, isSwapFromWallet: true, isSwapFeeInPmx: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      const minFee = BigNumber.from(feeAmountInEth).mul(2);
      await PrimexDNS.setFeeRestrictions(OrderType.SWAP_MARKET_ORDER, { minProtocolFee: minFee, maxProtocolFee: minFee.mul(2) });
      const { minFeeInFeeToken } = await calculateMinMaxFeeInFeeToken(OrderType.SWAP_MARKET_ORDER, PMXToken.address);

      await PMXToken.transfer(trader.address, minFeeInFeeToken);
      await PMXToken.connect(trader).approve(swapManager.address, minFeeInFeeToken);
      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalances(
        PMXToken,
        [trader.address, Treasury],
        [BigNumber.from(minFeeInFeeToken).mul(NegativeOne), minFeeInFeeToken],
      );
    });
    it("Should send max fee in PMX to treasury", async function () {
      const params = { ...swapParams, isSwapFromWallet: true, isSwapFeeInPmx: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      const maxFee = BigNumber.from(feeAmountInEth).div(2);
      await PrimexDNS.setFeeRestrictions(OrderType.SWAP_MARKET_ORDER, { minProtocolFee: 0, maxProtocolFee: maxFee });
      const { maxFeeInFeeToken } = await calculateMinMaxFeeInFeeToken(OrderType.SWAP_MARKET_ORDER, PMXToken.address);

      await PMXToken.transfer(trader.address, maxFeeInFeeToken);
      await PMXToken.connect(trader).approve(swapManager.address, maxFeeInFeeToken);
      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalances(
        PMXToken,
        [trader.address, Treasury],
        [BigNumber.from(maxFeeInFeeToken).mul(NegativeOne), maxFeeInFeeToken],
      );
    });
    it("Should swap and should not increase treasury balance if swapRateInPmx = 0 when fee in PMX", async function () {
      await PrimexDNS.setFeeRate([OrderType.SWAP_MARKET_ORDER, PMXToken.address, 0]);
      expect(await PrimexDNS.feeRates(OrderType.SWAP_MARKET_ORDER, PMXToken.address)).to.equal(0);
      expect(await PrimexDNS.feeRates(OrderType.SWAP_MARKET_ORDER, NATIVE_CURRENCY)).to.equal(swapRate);

      const params = { ...swapParams, isSwapFromWallet: true, isSwapFeeInPmx: true };
      await testTokenA.connect(trader).approve(traderBalanceVault.address, amountToConvert);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amountToConvert);

      await PMXToken.transfer(trader.address, feeAmountInPmx);
      await PMXToken.connect(trader).approve(swapManager.address, feeAmountInPmx);
      const treasuryBalanceBeforeSwap = await PMXToken.balanceOf(Treasury.address);

      await expect(() => swapManager.connect(trader).swap(params, 0, false)).to.changeTokenBalance(testTokenB, trader, amountOut);
      const treasuryBalanceAfterSwap = await PMXToken.balanceOf(Treasury.address);
      expect(treasuryBalanceBeforeSwap).to.equal(treasuryBalanceAfterSwap);
    });

    it("Should swap and should not increase treasury balance if swapRate = 0 when fee in ETH", async function () {
      await PrimexDNS.setFeeRate([OrderType.SWAP_MARKET_ORDER, NATIVE_CURRENCY, 0]);
      expect(await PrimexDNS.feeRates(OrderType.SWAP_MARKET_ORDER, NATIVE_CURRENCY)).to.equal(0);
      expect(await PrimexDNS.feeRates(OrderType.SWAP_MARKET_ORDER, PMXToken.address)).to.equal(swapRateInPmx);

      const treasuryBalanceBeforeSwap = await provider.getBalance(Treasury.address);

      await expect(() =>
        swapManager.connect(trader).swap(swapParams, 0, false, {
          value: feeAmountInEth,
        }),
      ).to.changeTokenBalance(testTokenA, trader, amountToConvert.mul(NegativeOne));

      const treasuryBalanceAfterSwap = await provider.getBalance(Treasury.address);
      expect(treasuryBalanceAfterSwap).to.equal(treasuryBalanceBeforeSwap);
    });
  });
});
