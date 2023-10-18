// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const {
  MAX_TOKEN_DECIMALITY,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  OrderType,
  NATIVE_CURRENCY,
  USD,
  USD_DECIMALS,
} = require("../utils/constants");

const { wadDiv, wadMul } = require("../utils/math");
const { getAmountsOut, addLiquidity, checkIsDexSupported, getSingleRoute } = require("../utils/dexOperations");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("../utils/conditionParams");

process.env.TEST = true;

describe("SpotTradingRewardDistributor_integration", function () {
  let dex,
    dex2,
    positionManager,
    traderBalanceVault,
    PrimexDNS,
    testTokenC,
    testTokenD,
    PMXToken,
    limitOrderManager,
    spotTradingRewardDistributor,
    firstAssetRoutes,
    pmx;
  let priceFeed, priceOracle, priceFeedTTDUSD, priceInETH;
  let deployer, trader, liquidator, user;
  let snapshotIdBase;
  let depositAmount, amountDOut, multiplierUSD;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, liquidator, user } = await getNamedSigners());
    depositAmount = parseEther("15");

    await run("deploy:ERC20Mock", {
      name: "TestTokenC",
      symbol: "TTC",
      decimals: "18",
    });
    await run("deploy:ERC20Mock", {
      name: "TestTokenD",
      symbol: "TTD",
      decimals: "18",
    });
    await run("deploy:ERC20Mock", {
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: "18",
    });
    testTokenC = await getContract("TestTokenC");
    testTokenD = await getContract("TestTokenD");
    PMXToken = await getContract("EPMXToken");

    await testTokenC.mint(trader.address, parseEther("100"));
    await testTokenC.mint(user.address, parseEther("100"));

    spotTradingRewardDistributor = await getContract("SpotTradingRewardDistributor");
    pmx = await getContract("EPMXToken");
    positionManager = await getContract("PositionManager");
    traderBalanceVault = await getContract("TraderBalanceVault");
    PrimexDNS = await getContract("PrimexDNS");
    limitOrderManager = await getContract("LimitOrderManager");

    await positionManager.setSpotTradingRewardDistributor(spotTradingRewardDistributor.address);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }

    checkIsDexSupported(dex);
    firstAssetRoutes = await getSingleRoute([testTokenC.address, testTokenD.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenC, tokenB: testTokenD });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenC, tokenB: testTokenD });

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals("18");
    amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
    const exchangeRate = BigNumber.from(wadDiv(amountDOut.toString(), depositAmount.toString()).toString());
    await priceFeed.setAnswer(exchangeRate);

    multiplierUSD = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(USD_DECIMALS));
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    priceFeedTTDUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTD_USD", deployer.address);
    await priceFeedTTDUSD.setAnswer(parseUnits("1", "8"));
    await priceFeedTTDUSD.setDecimals("8");

    priceOracle = await getContract("PriceOracle");
    const priceFeedTTCETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTC_ETH", deployer.address);
    const priceFeedTTDETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTD_ETH", deployer.address);
    await priceFeedTTCETH.setDecimals("18");
    await priceFeedTTDETH.setDecimals("18");

    priceInETH = parseUnits("0.3", 18); // 1 tta=0.3 ETH
    await priceFeedTTCETH.setAnswer(priceInETH);
    await priceFeedTTDETH.setAnswer(priceInETH);
    await priceOracle.updatePriceFeed(testTokenC.address, await priceOracle.eth(), priceFeedTTCETH.address);
    await priceOracle.updatePriceFeed(testTokenD.address, await priceOracle.eth(), priceFeedTTDETH.address);
    await priceOracle.updatePriceFeed(PMXToken.address, await priceOracle.eth(), priceFeedTTDETH.address);

    await priceOracle.updatePriceFeed(testTokenC.address, testTokenD.address, priceFeed.address);
    await priceOracle.updatePriceFeed(testTokenD.address, USD, priceFeedTTDUSD.address);

    await positionManager.setMaxPositionSize(testTokenC.address, testTokenD.address, 0, MaxUint256);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  describe("withdrawPmx", function () {
    let snapshotId;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should transfer pmx to the recipient and reduce contract balance", async function () {
      const treasury = await getContract("Treasury");
      await pmx.connect(deployer).approve(spotTradingRewardDistributor.address, MaxUint256);

      const undistributedPMX = parseEther("15");
      await spotTradingRewardDistributor.connect(deployer).topUpUndistributedPmxBalance(undistributedPMX);
      expect(await spotTradingRewardDistributor.undistributedPMX()).to.equal(undistributedPMX);

      const amountToWithdraw = parseEther("13");
      await expect(() => spotTradingRewardDistributor.connect(deployer).withdrawPmx(amountToWithdraw)).to.changeTokenBalances(
        pmx,
        [spotTradingRewardDistributor, treasury],
        [amountToWithdraw.mul(NegativeOne), amountToWithdraw],
      );
    });
  });

  describe("updateTraderActivity", function () {
    let orderId, snapshotId, order, slPrice, tpPrice, limitPrice, defaultAdditionalParams, rewardPerPeriod;
    before(async function () {
      const deadline = new Date().getTime() + 600;

      limitPrice = BigNumber.from(wadDiv(depositAmount.toString(), amountDOut.toString()).toString());
      const difference = parseEther("1");
      slPrice = limitPrice.sub(difference);
      tpPrice = limitPrice.add(difference);

      await testTokenC.connect(user).approve(limitOrderManager.address, MaxUint256);
      await testTokenC.connect(user).approve(positionManager.address, MaxUint256);
      await testTokenC.connect(trader).approve(positionManager.address, MaxUint256);

      await pmx.connect(deployer).approve(spotTradingRewardDistributor.address, MaxUint256);

      await traderBalanceVault.connect(user).deposit(NATIVE_CURRENCY, 0, {
        value: parseEther("1"),
      });

      const undistributedPMX = parseEther("1000");
      await spotTradingRewardDistributor.connect(deployer).topUpUndistributedPmxBalance(undistributedPMX);
      expect(await spotTradingRewardDistributor.undistributedPMX()).to.equal(undistributedPMX);

      rewardPerPeriod = parseEther("3");
      await spotTradingRewardDistributor.setRewardPerPeriod(rewardPerPeriod);

      await limitOrderManager.connect(user).createLimitOrder(
        {
          bucket: "",
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          deadline: deadline,
          takeDepositFromWallet: true,
          payFeeFromWallet: true,
          leverage: parseEther("1"),
          shouldOpenPosition: true,
          openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
          closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
          isProtocolFeeInPmx: false,
        },
        { value: parseEther("2") },
      );
      orderId = await limitOrderManager.ordersId();
      order = await limitOrderManager.getOrder(orderId);
      defaultAdditionalParams = getLimitPriceAdditionalParams(firstAssetRoutes, [], []);
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

    it("Should openPositionByOrder and update trader activity", async function () {
      await limitOrderManager.connect(liquidator).openPositionByOrder({
        orderId: orderId,
        conditionIndex: 0,
        comAdditionalParams: defaultAdditionalParams,
        firstAssetRoutes: firstAssetRoutes,
        depositInThirdAssetRoutes: [],
        keeper: liquidator.address,
      });

      const { positionAmount } = await positionManager.getPosition(0);

      let positionSizeInUsd = wadMul(positionAmount.toString(), parseEther("1").toString()).toString();
      positionSizeInUsd = BigNumber.from(positionSizeInUsd).div(multiplierUSD);

      const periodInfo = await spotTradingRewardDistributor.periods(0);
      expect(periodInfo.totalActivity).to.equal(positionSizeInUsd);
      expect(periodInfo.totalReward).to.equal(rewardPerPeriod);

      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, order.trader);
      expect(spotTraderActivity).to.equal(positionSizeInUsd);
    });

    it("Should openPosition by user and trader and update their trader's activity appropriately", async function () {
      const deadline = new Date().getTime() + 600;
      const marginParams = {
        bucket: "",
        borrowedAmount: BigNumber.from(0),
        depositToBorrowedRoutes: [],
        depositInThirdAssetRoutes: [],
      };

      const feeAmountCalculateWithETHRate = wadMul(
        depositAmount.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      const feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), priceInETH.toString()).toString();

      await positionManager.connect(user).openPosition(
        {
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: BigNumber.from(0),
          deadline: deadline,
          takeDepositFromWallet: true,
          payFeeFromWallet: true,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );
      const { positionAmount } = await positionManager.getPosition(0);

      let positionSizeInUsdUser = wadMul(positionAmount.toString(), parseEther("1").toString()).toString();
      positionSizeInUsdUser = BigNumber.from(positionSizeInUsdUser).div(multiplierUSD);

      const depositAmountTrader = depositAmount.div(2);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmountTrader,
          positionAsset: testTokenD.address,
          amountOutMin: BigNumber.from(0),
          deadline: deadline,
          takeDepositFromWallet: true,
          payFeeFromWallet: true,
          closeConditions: [],
        },
        { value: BigNumber.from(feeAmountInEth).div(2) },
      );
      const { positionAmount: positionSizeTrader } = await positionManager.getPosition(1);

      let positionSizeInUsdTrader = wadMul(positionSizeTrader.toString(), parseEther("1").toString()).toString();
      positionSizeInUsdTrader = BigNumber.from(positionSizeInUsdTrader).div(multiplierUSD);

      const periodInfo = await spotTradingRewardDistributor.periods(0);
      expect(periodInfo.totalActivity).to.equal(positionSizeInUsdUser.add(positionSizeInUsdTrader));
      expect(periodInfo.totalReward).to.equal(rewardPerPeriod);

      const spotTraderActivityUser = await spotTradingRewardDistributor.getSpotTraderActivity(0, user.address);
      expect(spotTraderActivityUser).to.equal(positionSizeInUsdUser);

      const spotTraderActivityTrader = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      expect(spotTraderActivityTrader).to.equal(positionSizeInUsdTrader);
    });
  });
  describe("claimReward", function () {
    it("Should transfer rewards on the balance in traderBalanceVault and reduce contract balance", async function () {
      const deadline = new Date().getTime() + 600;
      const feeAmountCalculateWithETHRate = wadMul(
        depositAmount.toString(),
        (await PrimexDNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
      ).toString();
      const feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), priceInETH.toString()).toString();
      const marginParams = {
        bucket: "",
        borrowedAmount: BigNumber.from(0),
        depositToBorrowedRoutes: [],
        depositInThirdAssetRoutes: [],
      };

      await testTokenC.connect(trader).approve(positionManager.address, MaxUint256);

      const rewardPerPeriod = parseEther("3");
      await spotTradingRewardDistributor.setRewardPerPeriod(rewardPerPeriod);

      await pmx.connect(deployer).approve(spotTradingRewardDistributor.address, MaxUint256);
      const undistributedPMX = parseEther("1000");
      await spotTradingRewardDistributor.connect(deployer).topUpUndistributedPmxBalance(undistributedPMX);

      await positionManager.connect(trader).openPosition(
        {
          marginParams: marginParams,
          firstAssetRoutes: firstAssetRoutes,
          depositAsset: testTokenC.address,
          depositAmount: depositAmount,
          positionAsset: testTokenD.address,
          amountOutMin: BigNumber.from(0),
          deadline: deadline,
          takeDepositFromWallet: true,
          payFeeFromWallet: true,
          closeConditions: [],
        },
        { value: feeAmountInEth },
      );

      const periodInfo = await spotTradingRewardDistributor.periods(0);
      expect(periodInfo.totalReward).to.equal(rewardPerPeriod);

      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      const claimReward = await spotTradingRewardDistributor.connect(trader).claimReward();
      const [traderBalance] = await traderBalanceVault.balances(trader.address, pmx.address);

      expect(traderBalance).to.equal(rewardPerPeriod);
      await expect(claimReward).to.changeTokenBalances(
        pmx,
        [spotTradingRewardDistributor, traderBalanceVault],
        [rewardPerPeriod.mul(NegativeOne), rewardPerPeriod],
      );
    });
  });
});
