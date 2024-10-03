// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  ethers: {
    getContract,
    getContractAt,
    BigNumber,
    getNamedSigners,
    constants: { MaxUint256, HashZero },
    utils: { parseEther, parseUnits, defaultAbiCoder },
  },
  deployments: { fixture },
} = require("hardhat");
const { wadDiv } = require("./utils/math");
const { checkIsDexSupported, getAmountsOut, addLiquidity, getSinglePath, getSingleMegaRoute } = require("./utils/dexOperations");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const { MAX_TOKEN_DECIMALITY, USD_DECIMALS, USD_MULTIPLIER } = require("./utils/constants");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setOraclePrice,
} = require("./utils/oracleUtils");

process.env.TEST = true;

describe("Balancer", function () {
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
    swapSize,
    dex,
    multiplierA,
    multiplierB,
    testTokenB,
    testTokenY,
    testTokenX,
    marginParams,
    pool;
  let depositAmount, amountOutMin, deadline, takeDepositFromWallet;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });

    await run("deploy:ERC20Mock", {
      name: "TestTokenY",
      symbol: "TTY",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    DNS = await getContract("PrimexDNS");
    dexAdapter = await getContract("DexAdapter");
    PositionManager = await getContract("PositionManager");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    testTokenY = await getContract("TestTokenY");
    testTokenX = await getContract("TestTokenX");
    dex = "balancer";
    checkIsDexSupported(dex);
    pool = await addLiquidity({
      dex: "balancer",
      amountADesired: "100",
      from: "lender",
      assets: [
        { token: testTokenA.address, weight: "3", amount: "100" },
        { token: testTokenB.address, weight: "3", amount: "100" },
        { token: testTokenY.address, weight: "2", amount: "100" },
        { token: testTokenX.address, weight: "2", amount: "100" },
      ],
    });
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
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenY, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));
    const { payload: payload1 } = await encodeFunctionData("setMaintenanceBuffer", [parseEther("0.01")], "PositionManagerExtension");
    await PositionManager.setProtocolParamsByAdmin(payload1);
    depositAmount = parseUnits("10", decimalsA);
    const borrowedAmount = parseUnits("20", decimalsA);
    swapSize = depositAmount.add(borrowedAmount);
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

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
  });

  it("Creating position through Balancer should work", async function () {
    const swap = swapSize.mul(multiplierA);
    const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address], [pool]);
    const amountB = amount0Out.mul(multiplierB);
    const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
    const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
    await setOraclePrice(testTokenA, testTokenB, price);

    await PositionManager.connect(trader).openPosition({
      marginParams: marginParams,
      firstAssetMegaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], "balancer", [pool]),
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

  it("should be reverted when the pool id is incorrect", async function () {
    await expect(
      PositionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetMegaRoutes: [
          {
            shares: 1,
            routes: [
              {
                to: testTokenB.address,
                paths: [
                  {
                    dexName: "balancer",
                    shares: BigNumber.from(1),
                    payload: defaultAbiCoder.encode(
                      ["address[]", "bytes32[]", "int256[]"],
                      [[testTokenA.address, testTokenB.address], [HashZero], [depositAmount, 0]],
                    ),
                  },
                ],
              },
            ],
          },
        ],
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
      }),
    ).to.be.revertedWith("BAL#500"); // Internal balancer error number
  });

  it("getAmountOut return correct value", async function () {
    expect(await getAmountsOut("balancer", parseUnits("1", decimalsA), [testTokenA.address, testTokenB.address], [pool])).to.be.equal(
      await dexAdapter
        .connect(deployer)
        .callStatic.getAmountsOutByPaths(
          parseUnits("1", decimalsA),
          await getSinglePath([testTokenA.address, testTokenB.address], "balancer", [pool]),
        ),
    );
  });
});
