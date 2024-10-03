// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { MaxUint256, NegativeOne },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { LIMIT_PRICE_CM_TYPE, TAKE_PROFIT_STOP_LOSS_CM_TYPE, NATIVE_CURRENCY, USD_DECIMALS, USD_MULTIPLIER } = require("../utils/constants");

const { wadDiv, wadMul } = require("../utils/math");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
const { getAmountsOut, addLiquidity, checkIsDexSupported, getSingleMegaRoute } = require("../utils/dexOperations");
const {
  getTakeProfitStopLossParams,
  getLimitPriceParams,
  getLimitPriceAdditionalParams,
  getCondition,
} = require("../utils/conditionParams");

const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
} = require("../utils/oracleUtils");

process.env.TEST = true;

describe("SpotTradingRewardDistributor_integration", function () {
  let dex,
    dex2,
    positionManager,
    traderBalanceVault,
    testTokenC,
    testTokenD,
    PMXToken,
    limitOrderManager,
    spotTradingRewardDistributor,
    firstAssetRoutes,
    pmx;
  let priceOracle;
  let deployer, trader, liquidator, user;
  let snapshotIdBase;
  let depositAmount, amountDOut;
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
    limitOrderManager = await getContract("LimitOrderManager");

    const { payload: payload1 } = await encodeFunctionData(
      "setSpotTradingRewardDistributor",
      [spotTradingRewardDistributor.address],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload1);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }

    checkIsDexSupported(dex);
    firstAssetRoutes = await getSingleMegaRoute([testTokenC.address, testTokenD.address], dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenC, tokenB: testTokenD });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenC, tokenB: testTokenD });
    amountDOut = await getAmountsOut(dex, depositAmount, [testTokenC.address, testTokenD.address]);
    priceOracle = await getContract("PriceOracle");

    const ttcPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenC, await priceOracle.eth(), ttcPriceInETH);
    await setupUsdOraclesForToken(testTokenD, parseUnits("1", USD_DECIMALS));

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenC.address, testTokenD.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload);

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

      await limitOrderManager.connect(user).createLimitOrder({
        bucket: "",
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        deadline: deadline,
        takeDepositFromWallet: true,
        leverage: parseEther("1"),
        shouldOpenPosition: true,
        openConditions: [getCondition(LIMIT_PRICE_CM_TYPE, getLimitPriceParams(limitPrice))],
        closeConditions: [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(tpPrice, slPrice))],
        isProtocolFeeInPmx: false,
        nativeDepositAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
      });
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
        firstAssetMegaRoutes: firstAssetRoutes,
        depositInThirdAssetMegaRoutes: [],
        keeper: liquidator.address,
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
      });
      const { positionAmount } = await positionManager.getPosition(0);
      let positionSizeInUsd = wadMul(positionAmount.toString(), parseEther("1").toString()).toString();
      positionSizeInUsd = BigNumber.from(positionSizeInUsd).div(USD_MULTIPLIER);

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
        depositInThirdAssetMegaRoutes: [],
      };
      await positionManager.connect(user).openPosition({
        marginParams: marginParams,
        firstAssetMegaRoutes: firstAssetRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: BigNumber.from(0),
        deadline: deadline,
        takeDepositFromWallet: true,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
      });
      const { positionAmount } = await positionManager.getPosition(0);

      let positionSizeInUsdUser = wadMul(positionAmount.toString(), parseEther("1").toString()).toString();
      positionSizeInUsdUser = BigNumber.from(positionSizeInUsdUser).div(USD_MULTIPLIER);

      const depositAmountTrader = depositAmount.div(2);

      await positionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetMegaRoutes: firstAssetRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmountTrader,
        positionAsset: testTokenD.address,
        amountOutMin: BigNumber.from(0),
        deadline: deadline,
        takeDepositFromWallet: true,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
      });
      const { positionAmount: positionSizeTrader } = await positionManager.getPosition(1);

      let positionSizeInUsdTrader = wadMul(positionSizeTrader.toString(), parseEther("1").toString()).toString();
      positionSizeInUsdTrader = BigNumber.from(positionSizeInUsdTrader).div(USD_MULTIPLIER);

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
      const marginParams = {
        bucket: "",
        borrowedAmount: BigNumber.from(0),
        depositToBorrowedRoutes: [],
        depositInThirdAssetMegaRoutes: [],
      };

      await testTokenC.connect(trader).approve(positionManager.address, MaxUint256);

      const rewardPerPeriod = parseEther("3");
      await spotTradingRewardDistributor.setRewardPerPeriod(rewardPerPeriod);

      await pmx.connect(deployer).approve(spotTradingRewardDistributor.address, MaxUint256);
      const undistributedPMX = parseEther("1000");
      await spotTradingRewardDistributor.connect(deployer).topUpUndistributedPmxBalance(undistributedPMX);

      await positionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetMegaRoutes: firstAssetRoutes,
        depositAsset: testTokenC.address,
        depositAmount: depositAmount,
        positionAsset: testTokenD.address,
        amountOutMin: BigNumber.from(0),
        deadline: deadline,
        takeDepositFromWallet: true,
        closeConditions: [],
        firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        thirdAssetOracleData: [],
        depositSoldAssetOracleData: [],
        positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
        nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenD),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenC),
        pullOracleData: [],
      });

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
