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
    constants: { HashZero, AddressZero },
    utils: { parseEther, parseUnits, keccak256, toUtf8Bytes },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const {
  addLiquidity,
  checkIsDexSupported,
  getAmountsOut,
  getEncodedPath,
  getMegaRoutes,
  getSingleMegaRoute,
  getAncillaryDexData,
} = require("../utils/dexOperations");
const { wadDiv, wadMul } = require("../utils/math");
const { WAD, MAX_TOKEN_DECIMALITY, USD_DECIMALS, USD_MULTIPLIER } = require("../utils/constants");
const {
  setupUsdOraclesForToken,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  setOraclePrice,
  reversePrice,
} = require("../utils/oracleUtils");
const { getConfigByName } = require("../../config/configUtils");
const {
  PrimexDNSconfig: { feeRates },
} = getConfigByName("generalConfig.json");

process.env.TEST = true;

describe("PrimexPricingLibrary_integration", function () {
  let dex, dex2, primexPricingLibrary, primexPricingLibraryMock, testTokenA, testTokenB, testTokenX;
  let priceOracle, primexDNS, dexAdapter, bucket, bucketAddress, positionManager;
  let deployer, trader, lender;
  let decimalsA, decimalsB;
  let multiplierA, multiplierB;
  let ErrorsLibrary;
  let ttaPriceInETH;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    ErrorsLibrary = await getContract("Errors");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    positionManager = await getContract("PositionManager");

    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    await testTokenX.mint(lender.address, parseEther("100"));
    await testTokenX.mint(trader.address, parseEther("100"));
    await testTokenX.mint(deployer.address, parseEther("100"));

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));

    primexPricingLibrary = await getContract("PrimexPricingLibrary");

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    priceOracle = await getContract("PriceOracle");
    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH
    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    primexDNS = await getContract("PrimexDNS");
    dexAdapter = await getContract("DexAdapter");
    bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);

    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();

    const registryAddress = await dexAdapter.registry();
    const registry = await getContractAt("PrimexRegistry", registryAddress);
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const txGrantRole = await registry.grantRole(VAULT_ACCESS_ROLE, primexPricingLibraryMock.address);
    await txGrantRole.wait();
  });

  describe("getOracleAmountsOut", function () {
    let snapshotId;
    let testToken8, testToken6, testTokenSecond8, testTokenSecond6, multiplier;
    before(async function () {
      multiplier = "2";

      await run("deploy:ERC20Mock", {
        name: "testToken8",
        symbol: "TT8",
        decimals: "8",
        initialAccounts: JSON.stringify([trader.address]),
        initialBalances: JSON.stringify([parseUnits("100", 8).toString()]),
      });
      await run("deploy:ERC20Mock", {
        name: "TestToken6",
        symbol: "TT6",
        decimals: "6",
        initialAccounts: JSON.stringify([trader.address]),
        initialBalances: JSON.stringify([parseUnits("100", 6).toString()]),
      });
      await run("deploy:ERC20Mock", {
        name: "testTokenSecond8",
        symbol: "TTS8",
        decimals: "8",
        initialAccounts: JSON.stringify([trader.address]),
        initialBalances: JSON.stringify([parseUnits("100", 8).toString()]),
      });
      await run("deploy:ERC20Mock", {
        name: "testTokenSecond6",
        symbol: "TTS6",
        decimals: "6",
        initialAccounts: JSON.stringify([trader.address]),
        initialBalances: JSON.stringify([parseUnits("100", 6).toString()]),
      });
      testToken8 = await getContract("testToken8");
      testToken6 = await getContract("TestToken6");

      testTokenSecond8 = await getContract("testTokenSecond8");
      testTokenSecond6 = await getContract("testTokenSecond6");
      await setupUsdOraclesForTokens(testToken8, testToken6, parseUnits("2", USD_DECIMALS));
      await setupUsdOraclesForTokens(testTokenSecond6, testTokenSecond8, parseUnits("2", USD_DECIMALS));
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

    it("Should return the correct amount2. In PriceFeed, the direction of tokens is token x, token y. The decimals of tokens x>y. Call getOracleAmountsOut(x,y,amount1)", async function () {
      const amount1 = parseUnits("10", 8);
      const amount2 = parseUnits("10", 6).mul(multiplier);
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testToken8.address,
          testToken6.address,
          amount1,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(testToken6),
        ),
      ).to.equal(amount2);
    });

    it("should return the correct amount2. In PriceFeed, the direction of tokens is token x, token y. The decimals of tokens x>y. Call getOracleAmountsOut(y,x,amount1)", async function () {
      const amount1 = parseUnits("10", 6);
      const amount2 = parseUnits("10", 8).div(multiplier);
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testToken6.address,
          testToken8.address,
          amount1,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(testToken8),
        ),
      ).to.equal(amount2);
    });

    it("should return the correct amount2. In PriceFeed, the direction of tokens is token y, token x. The decimals of tokens x>y. Call getOracleAmountsOut(y,x,amount1)", async function () {
      const amount1 = parseUnits("10", 6);
      const amount2 = parseUnits("10", 8).mul(multiplier);
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testTokenSecond6.address,
          testTokenSecond8.address,
          amount1,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(testTokenSecond8),
        ),
      ).to.equal(amount2);
    });

    it("should return the correct amount2. In PriceFeed, the direction of tokens is token y, token x. The decimals of tokens x>y. Call getOracleAmountsOut(x,y,amount1)", async function () {
      const amount1 = parseUnits("10", 8);
      const amount2 = parseUnits("10", 6).div(multiplier);
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testTokenSecond8.address,
          testTokenSecond6.address,
          amount1,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(testTokenSecond6),
        ),
      ).to.equal(amount2);
    });
  });

  describe("getDepositAmountInBorrowed", function () {
    let amountToConvert;

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      amountToConvert = parseUnits("1", decimalsA);
    });

    it("Should return correct amount", async function () {
      const amountOut = await getAmountsOut(dex, amountToConvert, [testTokenA.address, testTokenB.address]);
      expect(
        await primexPricingLibraryMock.callStatic.getDepositAmountInBorrowed(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amount: amountToConvert,
            megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex),
          },
          false,
          dexAdapter.address,
          priceOracle.address,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        ),
      ).to.be.equal(amountOut);
    });
  });

  describe("megaSwap", function () {
    let amountToConvert, amountOut;
    let snapshotId;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      amountToConvert = parseUnits("2", decimalsA);
      await testTokenA.mint(dexAdapter.address, parseUnits("100", decimalsA));

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenX });

      await addLiquidity({ dex: dex2, amountADesired: "5", from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex2, amountADesired: "5", from: "lender", tokenA: testTokenA, tokenB: testTokenX });
      await addLiquidity({ dex: dex2, amountADesired: "5", from: "lender", tokenA: testTokenB, tokenB: testTokenX });

      amountOut = (await getAmountsOut(dex, amountToConvert.div(2), [testTokenA.address, testTokenB.address])).add(
        await getAmountsOut(dex2, amountToConvert.div(2), [testTokenA.address, testTokenB.address]),
      );
      const amountToConvertInWadDecimals = amountToConvert.mul(multiplierA);
      const amountOutInWadDecimals = amountOut.mul(multiplierB);

      let limitPrice = wadDiv(amountOutInWadDecimals.toString(), amountToConvertInWadDecimals.toString()).toString();
      limitPrice = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, reversePrice(limitPrice.toString()));
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
    it("Should return correct amount", async function () {
      const actualAmount = await primexPricingLibraryMock.callStatic.megaSwap(
        {
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amountTokenA: amountToConvert,
          megaRoutes: await getMegaRoutes([
            {
              shares: 1,
              routesData: [
                {
                  to: testTokenB.address,
                  pathData: [
                    {
                      dex: dex,
                      path: [testTokenA.address, testTokenB.address],
                      shares: 1,
                    },
                    {
                      dex: dex2,
                      path: [testTokenA.address, testTokenB.address],
                      shares: 1,
                    },
                  ],
                },
              ],
            },
          ]),
          receiver: trader.address,
          deadline: new Date().getTime() + 600,
        },
        parseEther("0.5"),
        dexAdapter.address,
        priceOracle.address,
        true,
        getEncodedChainlinkRouteViaUsd(testTokenB),
      );

      if (dex === "quickswapv3") {
        const delta = wadMul(amountOut.toString(), parseEther("0.01").toString()).toString();
        expect(actualAmount).to.be.closeTo(amountOut, delta);
      } else {
        expect(actualAmount).to.be.equal(amountOut);
      }
    });

    it("should revert if first asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.megaSwap(
          {
            tokenA: testTokenX.address,
            tokenB: testTokenB.address,
            amountTokenA: parseUnits("1", await testTokenX.decimals()),
            megaRoutes: await getSingleMegaRoute([testTokenX.address, testTokenB.address], dex),
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          0,
          dexAdapter.address,
          priceOracle.address,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        ),
      ).to.be.revertedWith("TransferHelper: TRANSFER_FROM_FAILED");
    });

    it("should revert if last asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.megaSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: parseUnits("1", await testTokenA.decimals()),
            megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenX.address], dex),
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          1,
          dexAdapter.address,
          priceOracle.address,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });

    it("should swap when path length > 2", async function () {
      const amountIn = parseUnits("2", await testTokenA.decimals());

      const amountOut = await getAmountsOut(dex, amountIn, [testTokenA.address, testTokenX.address, testTokenB.address]);

      expect(
        await primexPricingLibraryMock.callStatic.megaSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: amountIn,
            megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenX.address, testTokenB.address], dex),
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          0,
          dexAdapter.address,
          priceOracle.address,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        ),
      ).to.be.equal(amountOut);
    });

    it("should swap when path has different dexes", async function () {
      const amountIn = parseUnits("2", await testTokenA.decimals());

      const amountOutAB = await getAmountsOut(dex, amountIn, [testTokenA.address, testTokenX.address, testTokenB.address]);
      const amountOut = await getAmountsOut(dex2, amountOutAB, [testTokenB.address, testTokenX.address]);

      expect(
        await primexPricingLibraryMock.callStatic.megaSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenX.address,
            amountTokenA: amountIn,
            megaRoutes: await getMegaRoutes([
              {
                shares: 1,
                routesData: [
                  {
                    to: testTokenB.address,
                    pathData: [
                      {
                        dex: dex,
                        path: [testTokenA.address, testTokenX.address, testTokenB.address],
                        shares: 1,
                      },
                    ],
                  },
                  {
                    to: testTokenX.address,
                    pathData: [
                      {
                        dex: dex2,
                        path: [testTokenB.address, testTokenX.address],
                        shares: 1,
                      },
                    ],
                  },
                ],
              },
            ]),
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          0,
          dexAdapter.address,
          priceOracle.address,
          false,
          getEncodedChainlinkRouteViaUsd(testTokenX),
        ),
      ).to.be.equal(amountOut);
    });

    it("should revert when dex returns a value but doesn't swap anything", async function () {
      const factory = await getContractFactory("MaliciousDexMock");
      const MaliciousDexMock = await factory.deploy();
      const dexName = "MaliciousDex";

      await run("PrimexDNS:addDEX", { name: dexName, routerAddress: MaliciousDexMock.address, primexDNS: primexDNS.address });
      await run("DexAdapter:setDexType", { dexType: "1", router: MaliciousDexMock.address, dexAdapter: dexAdapter.address });

      await expect(
        primexPricingLibraryMock.callStatic.megaSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: parseUnits("1", await testTokenA.decimals()),
            megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenB.address], dexName),
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          1,
          dexAdapter.address,
          priceOracle.address,
          true,
          getEncodedChainlinkRouteViaUsd(testTokenB),
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });
  });

  describe("getLiquidationPrice", function () {
    it("Should return correct price for position", async function () {
      const depositAmount = parseUnits("2", decimalsA);
      const borrowedAmount = parseUnits("5", decimalsA);
      const positionAmount = await getAmountsOut(dex, depositAmount.add(borrowedAmount), [testTokenA.address, testTokenB.address]);

      const liquidationPricePreliminary = await primexPricingLibraryMock.getLiquidationPrice(
        bucketAddress,
        testTokenB.address,
        positionAmount,
        borrowedAmount,
        primexDNS.address,
      );

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);
      const feeRate = parseEther(feeRates.MarginPositionClosedByKeeper);
      const denominator = wadMul(
        wadMul(
          wadMul(BigNumber.from(WAD).sub(securityBuffer).toString(), BigNumber.from(WAD).sub(oracleTolerableLimit).toString()),
          wadMul(BigNumber.from(WAD).sub(pairPriceDrop).toString(), BigNumber.from(WAD).sub(feeRate).toString()),
        ),
        positionAmount.toString(),
      ).toString();
      const numerator = wadMul(feeBuffer.toString(), borrowedAmount.toString()).toString();

      const denominatorInWadDecimals = BigNumber.from(denominator).mul(multiplierB);
      const numeratorInWadDecimals = BigNumber.from(numerator).mul(multiplierA);

      let liquidationPrice = wadDiv(numeratorInWadDecimals.toString(), denominatorInWadDecimals.toString()).toString();
      liquidationPrice = BigNumber.from(liquidationPrice).div(multiplierA);
      expect(liquidationPrice).to.equal(liquidationPricePreliminary);
    });
  });

  describe("getLiquidationPriceByOrder", function () {
    it("Should return correct price for order", async function () {
      const limitPrice = parseUnits("2", decimalsA);
      const leverage = parseEther("5");

      const liquidationPricePreliminary = await primexPricingLibraryMock.getLiquidationPriceByOrder(
        bucketAddress,
        testTokenB.address,
        limitPrice,
        leverage,
      );

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

      const denominator = wadMul(
        wadMul(
          wadMul(BigNumber.from(WAD).sub(securityBuffer).toString(), BigNumber.from(WAD).sub(oracleTolerableLimit).toString()),
          BigNumber.from(WAD).sub(pairPriceDrop).toString(),
        ),
        leverage.toString(),
      ).toString();
      const numerator = wadMul(feeBuffer.toString(), leverage.sub(BigNumber.from(WAD)).toString()).toString();
      const liquidationPrice = wadMul(limitPrice.toString(), wadDiv(numerator, denominator.toString()).toString()).toString();
      expect(liquidationPrice).to.equal(liquidationPricePreliminary);
    });
  });

  describe("Encode path", function () {
    let dex, path, dexRouter, ancillaryDexData;

    it("Should encode path for uniswap", async function () {
      dex = "uniswap";
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address];
      const encodedPath = await getEncodedPath(path, dex);
      expect(await primexPricingLibrary.encodePath(path, dexRouter, HashZero, dexAdapter.address, false)).to.equal(encodedPath);
    });

    it("Should encode path for uniswapv3", async function () {
      dex = "uniswapv3";
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address];
      ancillaryDexData = await getAncillaryDexData({ dex: dex });
      const encodedPath = await getEncodedPath(path, dex);
      expect(await primexPricingLibrary.encodePath(path, dexRouter, ancillaryDexData, dexAdapter.address, false)).to.equal(encodedPath);
    });

    it("Should encode path for curve", async function () {
      dex = "curve";
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address];
      ancillaryDexData = await getAncillaryDexData({ dex: dex, pool: AddressZero });
      const encodedPath = await getEncodedPath(path, dex, [AddressZero]);
      expect(await primexPricingLibrary.encodePath(path, dexRouter, ancillaryDexData, dexAdapter.address, false)).to.equal(encodedPath);
    });

    it("Should encode path for balancer", async function () {
      dex = "balancer";
      const poolBalancer = await addLiquidity({
        dex: dex,
        from: "lender",
        assets: [
          { token: testTokenA.address, weight: "3", amount: "300" },
          { token: testTokenB.address, weight: "3", amount: "300" },
          { token: testTokenX.address, weight: "4", amount: "300" },
        ],
      });
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address];
      ancillaryDexData = await getAncillaryDexData({ dex: dex, pool: poolBalancer });
      const encodedPath = await getEncodedPath(path, dex, [poolBalancer]);
      expect(await primexPricingLibrary.encodePath(path, dexRouter, ancillaryDexData, dexAdapter.address, false)).to.equal(encodedPath);
    });

    it("Should revert encode path when dex is not supported", async function () {
      path = [testTokenA.address, testTokenB.address];
      await expect(primexPricingLibrary.encodePath(path, AddressZero, HashZero, dexAdapter.address, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "UNKNOWN_DEX_TYPE",
      );
    });
  });

  describe("Decode path", function () {
    let dex, path, dexRouter;

    it("Should decode path for uniswap", async function () {
      dex = "uniswap";
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address, testTokenX.address];
      const encodedPath = await getEncodedPath(path, dex);
      expect(await primexPricingLibrary.decodePath(encodedPath, dexRouter, dexAdapter.address)).to.deep.equal(path);
    });

    it("Should decode path for uniswapv3", async function () {
      dex = "uniswapv3";
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address, testTokenX.address];
      const encodedPath = await getEncodedPath(path, dex, ["3000", "3000"]);
      expect(await primexPricingLibrary.decodePath(encodedPath, dexRouter, dexAdapter.address)).to.deep.equal(path);
    });

    it("Should decode path for curve", async function () {
      dex = "curve";
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address, testTokenX.address];
      const encodedPath = await getEncodedPath(path, dex, [AddressZero, AddressZero]);
      expect(await primexPricingLibrary.decodePath(encodedPath, dexRouter, dexAdapter.address)).to.deep.equal(path);
    });

    it("Should decode path for balancer", async function () {
      dex = "balancer";
      const poolBalancer = await addLiquidity({
        dex: dex,
        from: "lender",
        assets: [
          { token: testTokenA.address, weight: "3", amount: "300" },
          { token: testTokenB.address, weight: "3", amount: "300" },
          { token: testTokenX.address, weight: "4", amount: "300" },
        ],
      });
      dexRouter = await primexDNS.getDexAddress(dex);
      path = [testTokenA.address, testTokenB.address, testTokenX.address];
      const encodedPath = await getEncodedPath(path, dex, [poolBalancer, poolBalancer]);
      expect(await primexPricingLibrary.decodePath(encodedPath, dexRouter, dexAdapter.address)).to.deep.equal(path);
    });

    it("Should revert decode path when dex is not supported", async function () {
      dex = "uniswap";
      path = [testTokenA.address, testTokenB.address, testTokenX.address];
      const encodedPath = await getEncodedPath(path, dex);
      await expect(primexPricingLibrary.decodePath(encodedPath, AddressZero, dexAdapter.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "UNKNOWN_DEX_TYPE",
      );
    });
  });
});
