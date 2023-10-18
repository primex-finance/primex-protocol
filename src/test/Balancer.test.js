// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    BigNumber,
    getNamedSigners,
    constants: { MaxUint256, HashZero },
    utils: { parseEther, parseUnits, defaultAbiCoder },
  },
  deployments: { fixture },
} = require("hardhat");
const { getAmountsOut, addLiquidity, getEncodedPath } = require("./utils/dexOperations");
const { wadMul } = require("./utils/math");
const { OrderType, MAX_TOKEN_DECIMALITY, NATIVE_CURRENCY } = require("./utils/constants");

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
    multiplierA,
    primexPricingLibrary,
    primexPricingLibraryMock,
    testTokenB,
    testTokenY,
    testTokenX,
    marginParams,
    pool;
  let depositAmount, amountOutMin, feeAmountInEth, deadline, takeDepositFromWallet;

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
    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    testTokenY = await getContract("TestTokenY");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    testTokenX = await getContract("TestTokenX");
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

    await PositionManager.setMaxPositionSize(testTokenA.address, testTokenB.address, 0, MaxUint256);

    const priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    const priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);
    // a stub so that the tests do not fail.
    // It is important in it that the position has opened and not the conditions for its opening
    await priceFeed.setAnswer(1);
    await priceFeed.setDecimals(decimalsB);
    await PositionManager.setMaintenanceBuffer(parseEther("0.01"));

    marginParams = {
      bucket: "bucket1",
      borrowedAmount: parseUnits("20", decimalsA),
      depositInThirdAssetRoutes: [],
    };

    depositAmount = parseUnits("10", decimalsA);
    const swapSize = depositAmount.add(marginParams.borrowedAmount);
    const lenderAmount = parseUnits("100", decimalsA);
    amountOutMin = 0;
    deadline = new Date().getTime() + 600;
    takeDepositFromWallet = false;

    await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount.mul(2));
    await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount.mul(2));

    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender).deposit(lender.address, lenderAmount);

    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAETH = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_ETH", deployer.address);
    const ttaPriceInETH = parseUnits("0.3", "18"); // 1 tta=0.3 eth
    await priceFeedTTAETH.setDecimals("18");
    await priceFeedTTAETH.setAnswer(ttaPriceInETH);
    await priceOracle.updatePriceFeed(testTokenA.address, await priceOracle.eth(), priceFeedTTAETH.address);

    const feeAmountCalculateWithETHRate = wadMul(
      swapSize.mul(multiplierA).toString(),
      (await DNS.feeRates(OrderType.MARKET_ORDER, NATIVE_CURRENCY)).toString(),
    ).toString();
    feeAmountInEth = wadMul(feeAmountCalculateWithETHRate.toString(), ttaPriceInETH.toString()).toString();
    await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: BigNumber.from(feeAmountInEth).mul("2") });
  });

  it("Creating position through Balancer should work", async function () {
    await PositionManager.connect(trader).openPosition({
      marginParams: marginParams,
      firstAssetRoutes: [
        {
          shares: 1,
          paths: [
            {
              dexName: "balancer",
              encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], "balancer", [pool]),
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
    });
  });

  it("should be reverted when the pool id is incorrect", async function () {
    await expect(
      PositionManager.connect(trader).openPosition({
        marginParams: marginParams,
        firstAssetRoutes: [
          {
            shares: 1,
            paths: [
              {
                dexName: "balancer",
                encodedPath: defaultAbiCoder.encode(
                  ["address[]", "bytes32[]", "int256[]"],
                  [[testTokenA.address, testTokenB.address], [HashZero], [depositAmount, 0]],
                ),
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
      }),
    ).to.be.revertedWith("BAL#500"); // Internal balancer error number
  });

  it("getAmountOut return correct value ", async function () {
    expect(await getAmountsOut("balancer", parseUnits("1", decimalsA), [testTokenA.address, testTokenB.address], [pool])).to.be.equal(
      await primexPricingLibraryMock.connect(deployer).callStatic.getAmountOut({
        tokenA: testTokenA.address,
        tokenB: testTokenB.address,
        amount: parseUnits("1", decimalsA),
        routes: [
          {
            shares: 1,
            paths: [
              {
                dexName: "balancer",
                encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], "balancer", [pool]),
              },
            ],
          },
        ],
        dexAdapter: dexAdapter.address,
        primexDNS: DNS.address,
      }),
    );
  });
});
