// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getContract,
    getContractAt,
    BigNumber,
    getNamedSigners,
    constants: { MaxUint256, AddressZero },
    utils: { parseEther, parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");
const { addLiquidity, getSingleMegaRoute } = require("./utils/dexOperations");
const { NATIVE_CURRENCY, ETH, USD_DECIMALS } = require("./utils/constants");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
} = require("./utils/oracleUtils");

process.env.TEST = true;

describe("Paraswap", function () {
  let DNS,
    dexAdapter,
    PositionManager,
    deployer,
    trader,
    traderBalanceVault,
    lender,
    bucket,
    testTokenA,
    decimalsA,
    decimalsB,
    testTokenB,
    ErrorsLibrary,
    marginParams,
    borrowedAmount,
    BuyData;
  let depositAmount, amountOutMin, deadline, takeDepositFromWallet;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());

    DNS = await getContract("PrimexDNS");
    dexAdapter = await getContract("DexAdapter");
    PositionManager = await getContract("PositionManager");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    ErrorsLibrary = await getContract("Errors");

    await addLiquidity({ dex: "paraswap", from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    traderBalanceVault = await getContract("TraderBalanceVault");
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    const bucketAddress = (await DNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    const { payload } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await PositionManager.setProtocolParamsByAdmin(payload);
    const priceOracle = await getContract("PriceOracle");
    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("10", USD_DECIMALS));

    const { payload: payload1 } = await encodeFunctionData("setMaintenanceBuffer", [parseEther("0.01")], "PositionManagerExtension");
    await PositionManager.setProtocolParamsByAdmin(payload1);

    depositAmount = parseUnits("10", decimalsA);
    borrowedAmount = parseUnits("20", decimalsA);

    marginParams = {
      bucket: "bucket1",
      borrowedAmount: borrowedAmount,
      depositInThirdAssetMegaRoutes: [],
    };

    const lenderAmount = parseUnits("100", decimalsA);
    amountOutMin = 0;
    deadline = new Date().getTime() + 600;
    takeDepositFromWallet = false;

    await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount.mul(2));
    await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount.mul(2));

    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    const Route = {
      index: 0,
      targetExchange: AddressZero,
      percent: 100,
      payload: "0x",
      networkFee: 0,
    };

    BuyData = {
      adapter: AddressZero,
      fromToken: testTokenA.address,
      toToken: testTokenB.address,
      fromAmount: parseUnits("1", decimalsA).toString(),
      toAmount: parseUnits("3", decimalsB).toString(),
      expectedAmount: parseUnits("3", decimalsB).toString(),
      beneficiary: PositionManager.address,
      route: [Route],
      partner: AddressZero,
      feePercent: 0,
      permit: "0x",
      deadline: 0,
      uuid: "0x00000000000000000000000000000000",
    };
  });

  it("Should revert openPosition when amountOutMin is more than an actual amount", async function () {
    const { payload } = await encodeFunctionData("buy", [BuyData], "ParaswapMock");
    await expect(
      PositionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], "paraswap", [payload]),
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: BigNumber.from(BuyData.toAmount).add("1").toString(),
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
      }),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
  });

  it("Should revert openPosition when the recipient is not correct", async function () {
    const { payload } = await encodeFunctionData("buy", [{ ...BuyData, beneficiary: trader.address }], "ParaswapMock");
    await expect(
      PositionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], "paraswap", [payload]),
        depositAsset: testTokenA.address,
        depositAmount: depositAmount,
        positionAsset: testTokenB.address,
        amountOutMin: BuyData.toAmount,
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
      }),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
  });

  it("Creating position through paraswap (via buy function) should work", async function () {
    const { payload } = await encodeFunctionData("buy", [BuyData], "ParaswapMock");
    await PositionManager.connect(trader).openPosition({
      marginParams: marginParams,
      firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], "paraswap", [payload]),
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
    });
  });
  it("Should revert swapExactTokensForTokens when tokenIn is the native currency and msg.value is zero", async function () {
    const nativeAmount = parseEther("1").toString();
    const { payload } = await encodeFunctionData("buy", [{ ...BuyData, fromAmount: nativeAmount, fromToken: ETH }], "ParaswapMock");
    const router = (await DNS.dexes("paraswap")).routerAddress;
    await expect(
      dexAdapter.swapExactTokensForTokens(
        [payload, NATIVE_CURRENCY, testTokenB.address, nativeAmount, amountOutMin, deployer.address, deadline, router],
        { value: 0 },
      ),
    ).to.be.revertedWith("Address: insufficient balance for call");
  });
  it("Should swapExactTokensForTokens when tokenIn is the native currency", async function () {
    const nativeAmount = parseEther("1").toString();
    BuyData.beneficiary = deployer.address;
    const { payload } = await encodeFunctionData("buy", [{ ...BuyData, fromAmount: nativeAmount, fromToken: ETH }], "ParaswapMock");
    const router = (await DNS.dexes("paraswap")).routerAddress;
    const returnData = await dexAdapter.callStatic.swapExactTokensForTokens(
      [payload, NATIVE_CURRENCY, testTokenB.address, nativeAmount, amountOutMin, deployer.address, deadline, router],
      { value: nativeAmount },
    );

    expect(returnData[0]).to.be.equal(nativeAmount);
    expect(returnData[1]).to.be.equal(BuyData.toAmount);
    expect(returnData[2]).to.be.equal(0);

    await dexAdapter.swapExactTokensForTokens(
      [payload, NATIVE_CURRENCY, testTokenB.address, nativeAmount, amountOutMin, deployer.address, deadline, router],
      { value: nativeAmount },
    );
  });
});
