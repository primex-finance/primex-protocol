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
const assert = require("assert");
const {
  addLiquidity,
  checkIsDexSupported,
  getAmountsOut,
  getAmountsIn,
  getEncodedPath,
  getSingleRoute,
  getAncillaryDexData,
} = require("../utils/dexOperations");
const { wadDiv, wadMul } = require("../utils/math");
const { WAD, MAX_TOKEN_DECIMALITY } = require("../utils/constants");

process.env.TEST = true;

describe("PrimexPricingLibrary_integration", function () {
  let dex, dex2, primexPricingLibrary, primexPricingLibraryMock, testTokenA, testTokenB, testTokenX;
  let priceFeed, priceOracle, primexDNS, dexAdapter, bucket, bucketAddress, positionManager;
  let deployer, trader, lender;
  let decimalsA, decimalsB;
  let multiplierA, multiplierB;
  let ErrorsLibrary;

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

    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await priceFeed.setDecimals(decimalsB);
    priceOracle = await getContract("PriceOracle");
    await priceOracle.updatePriceFeed(testTokenA.address, testTokenB.address, priceFeed.address);
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
    let testToken8, testToken6, testTokenSecond8, testTokenSecond6, priceFeed8to6, priceFeed6to8, multiplier;
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

      const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
      priceFeed8to6 = await PrimexAggregatorV3TestServiceFactory.deploy(
        "PrimexAggregatorV3TestService asset 8 to asset 6 decimals",
        deployer.address,
      );
      priceFeed6to8 = await PrimexAggregatorV3TestServiceFactory.deploy(
        "PrimexAggregatorV3TestService asset 6 to asset 8 decimals",
        deployer.address,
      );

      await priceOracle.updatePriceFeed(testToken8.address, testToken6.address, priceFeed8to6.address);
      await priceOracle.updatePriceFeed(testTokenSecond6.address, testTokenSecond8.address, priceFeed6to8.address);
      await priceFeed8to6.setAnswer(parseUnits("2", 6));
      await priceFeed8to6.setDecimals("6");
      await priceFeed6to8.setAnswer(parseUnits("2", 8));
      await priceFeed6to8.setDecimals("8");
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
      expect(await primexPricingLibrary.getOracleAmountsOut(testToken8.address, testToken6.address, amount1, priceOracle.address)).to.equal(
        amount2,
      );
    });

    it("should return the correct amount2. In PriceFeed, the direction of tokens is token x, token y. The decimals of tokens x>y. Call getOracleAmountsOut(y,x,amount1)", async function () {
      const amount1 = parseUnits("10", 6);
      const amount2 = parseUnits("10", 8).div(multiplier);
      expect(await primexPricingLibrary.getOracleAmountsOut(testToken6.address, testToken8.address, amount1, priceOracle.address)).to.equal(
        amount2,
      );
    });

    it("should return the correct amount2. In PriceFeed, the direction of tokens is token y, token x. The decimals of tokens x>y. Call getOracleAmountsOut(y,x,amount1)", async function () {
      const amount1 = parseUnits("10", 6);
      const amount2 = parseUnits("10", 8).mul(multiplier);
      expect(
        await primexPricingLibrary.getOracleAmountsOut(testTokenSecond6.address, testTokenSecond8.address, amount1, priceOracle.address),
      ).to.equal(amount2);
    });

    it("should return the correct amount2. In PriceFeed, the direction of tokens is token y, token x. The decimals of tokens x>y. Call getOracleAmountsOut(x,y,amount1)", async function () {
      const amount1 = parseUnits("10", 8);
      const amount2 = parseUnits("10", 6).div(multiplier);
      expect(
        await primexPricingLibrary.getOracleAmountsOut(testTokenSecond8.address, testTokenSecond6.address, amount1, priceOracle.address),
      ).to.equal(amount2);
    });
  });

  describe("getAmountOut", function () {
    let tokenPairs = [];
    const tokenPairsLength = 6;
    let dexes = [];
    const dexesLength = 2;

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      tokenPairs = [
        [testTokenA, testTokenB],
        [testTokenA, testTokenX],
        [testTokenB, testTokenA],
        [testTokenB, testTokenX],
        [testTokenX, testTokenA],
        [testTokenX, testTokenB],
      ];
      expect(tokenPairs.length).to.be.equal(tokenPairsLength);
      dexes = [dex, dex2];
      expect(dexes.length).to.be.equal(dexesLength);

      await addLiquidity({
        dex: dex,
        amountADesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsA)).toString(),
        amountBDesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsB)).toString(),
        tokenA: testTokenA,
        tokenB: testTokenB,
      });
      await addLiquidity({
        dex: dex,
        amountADesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsA)).toString(),
        amountBDesired: "500",
        tokenA: testTokenA,
        tokenB: testTokenX,
      });
      await addLiquidity({
        dex: dex,
        amountADesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsB)).toString(),
        amountBDesired: "500",
        tokenA: testTokenB,
        tokenB: testTokenX,
      });

      await addLiquidity({
        dex: dex2,
        amountADesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsA)).toString(),
        amountBDesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsB)).toString(),
        tokenA: testTokenA,
        tokenB: testTokenB,
      });
      await addLiquidity({
        dex: dex2,
        amountADesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsA)).toString(),
        amountBDesired: "500",
        tokenA: testTokenA,
        tokenB: testTokenX,
      });
      await addLiquidity({
        dex: dex2,
        amountADesired: parseUnits("500", MAX_TOKEN_DECIMALITY.sub(decimalsB)).toString(),
        amountBDesired: "500",
        tokenA: testTokenB,
        tokenB: testTokenX,
      });
    });
    for (let i = 0; i < tokenPairsLength; i++) {
      for (let j = 0; j < dexesLength; j++) {
        it("getAmountOut", async function () {
          // naming configuration hack
          const input = ` ${await tokenPairs[i][0].name()} to ${await tokenPairs[i][1].name()} on ${dexes[j]}`;
          this._runnable.title = this._runnable.title + input;
          assert(typeof input === "string");
          const amountOut = await getAmountsOut(dexes[j], parseUnits("1", await tokenPairs[i][0].decimals()), [
            tokenPairs[i][0].address,
            tokenPairs[i][1].address,
          ]);
          expect(
            await primexPricingLibraryMock.callStatic.getAmountOut({
              tokenA: tokenPairs[i][0].address,
              tokenB: tokenPairs[i][1].address,
              amount: parseUnits("1", await tokenPairs[i][0].decimals()),
              routes: await getSingleRoute([tokenPairs[i][0].address, tokenPairs[i][1].address], dexes[j], 1),
              dexAdapter: dexAdapter.address,
              primexDNS: primexDNS.address,
            }),
          ).to.be.equal(amountOut);
        });
        it("getAmountIn", async function () {
          // naming configuration hack
          const input = ` ${await tokenPairs[i][0].name()} to ${await tokenPairs[i][1].name()} on ${dexes[j]}`;
          this._runnable.title = this._runnable.title + input;
          assert(typeof input === "string");
          const amountIn = await getAmountsIn(dexes[j], parseUnits("1", await tokenPairs[i][0].decimals()), [
            tokenPairs[i][0].address,
            tokenPairs[i][1].address,
          ]);
          expect(
            await primexPricingLibraryMock.callStatic.getAmountIn({
              tokenA: tokenPairs[i][0].address,
              tokenB: tokenPairs[i][1].address,
              amount: parseUnits("1", await tokenPairs[i][0].decimals()),
              routes: await getSingleRoute([tokenPairs[i][0].address, tokenPairs[i][1].address], dexes[j], 1),
              dexAdapter: dexAdapter.address,
              primexDNS: primexDNS.address,
            }),
          ).to.be.equal(amountIn);
        });
      }
    }

    it("should revert getAmountOut if first asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: parseUnits("1", await testTokenA.decimals()),
          routes: await getSingleRoute([testTokenX.address, testTokenB.address], dex),
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_PATH");
    });
    it("should revert getAmountIn if last asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.getAmountIn({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: parseUnits("1", await testTokenB.decimals()),
          routes: await getSingleRoute([testTokenA.address, testTokenX.address], dex),
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_PATH");
    });

    it("should revert getAmountOut if last asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: parseUnits("1", await testTokenA.decimals()),
          routes: await getSingleRoute([testTokenA.address, testTokenX.address], dex),
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_PATH");
    });

    it("should revert getAmountIn if first asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.getAmountIn({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: parseUnits("1", await testTokenA.decimals()),
          routes: await getSingleRoute([testTokenX.address, testTokenB.address], dex),
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_PATH");
    });

    it("should getAmountOut when path length > 2", async function () {
      const amountIn = parseUnits("1", await testTokenA.decimals());

      const amountOut = await getAmountsOut(dex, amountIn, [testTokenA.address, testTokenX.address, testTokenB.address]);
      expect(
        await primexPricingLibraryMock.callStatic.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: amountIn,
          routes: await getSingleRoute([testTokenA.address, testTokenX.address, testTokenB.address], dex, 1),
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.equal(amountOut);
    });

    it("should getAmountOut when path has different dexes", async function () {
      const amountIn = parseUnits("1", await testTokenA.decimals());

      const amountOutAB = await getAmountsOut(dex, amountIn, [testTokenA.address, testTokenX.address, testTokenB.address]);
      const amountOut = await getAmountsOut(dex2, amountOutAB, [testTokenB.address, testTokenX.address]);
      expect(
        await primexPricingLibraryMock.callStatic.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenX.address,
          amount: amountIn,
          routes: [
            {
              shares: 1,
              paths: [
                {
                  dexName: dex,
                  encodedPath: await getEncodedPath([testTokenA.address, testTokenX.address, testTokenB.address], dex),
                },
                {
                  dexName: dex2,
                  encodedPath: await getEncodedPath([testTokenB.address, testTokenX.address], dex2),
                },
              ],
            },
          ],
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.equal(amountOut);
    });

    it("should getAmountIn when path has different dexes", async function () {
      const amountOut = parseUnits("1", await testTokenA.decimals());

      const amountInBX = await getAmountsIn(dex2, amountOut, [testTokenB.address, testTokenX.address]);
      const amountIn = await getAmountsIn(dex, amountInBX, [testTokenA.address, testTokenX.address, testTokenB.address]);
      expect(
        await primexPricingLibraryMock.callStatic.getAmountIn({
          tokenA: testTokenA.address,
          tokenB: testTokenX.address,
          amount: amountOut,
          routes: [
            {
              shares: 1,
              paths: [
                {
                  dexName: dex,
                  encodedPath: await getEncodedPath([testTokenA.address, testTokenX.address, testTokenB.address], dex),
                },
                {
                  dexName: dex2,
                  encodedPath: await getEncodedPath([testTokenB.address, testTokenX.address], dex2),
                },
              ],
            },
          ],
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.equal(amountIn);
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
            routes: await getSingleRoute([testTokenA.address, testTokenB.address], dex, 1),
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
          },
          false,
          priceOracle.address,
        ),
      ).to.be.equal(amountOut);
    });
  });

  describe("multiSwap", function () {
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
      limitPrice = BigNumber.from(limitPrice).div(multiplierB);

      await priceFeed.setAnswer(limitPrice);
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
      const actualAmount = await primexPricingLibraryMock.callStatic.multiSwap(
        {
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amountTokenA: amountToConvert,
          routes: [
            {
              shares: 1,
              paths: [
                {
                  dexName: dex,
                  encodedPath: await getEncodedPath([testTokenA.address, testTokenB.address], dex),
                },
              ],
            },
            {
              shares: 1,
              paths: [
                {
                  dexName: dex2,
                  encodedPath: await getEncodedPath([testTokenA.address, testTokenB.address], dex2),
                },
              ],
            },
          ],
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
          receiver: trader.address,
          deadline: new Date().getTime() + 600,
        },
        parseEther("0.001"),
        primexDNS.address,
        priceOracle.address,
        true,
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
        primexPricingLibraryMock.callStatic.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: parseUnits("1", await testTokenA.decimals()),
            routes: await getSingleRoute([testTokenX.address, testTokenB.address], dex),
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          true,
        ),
      ).to.be.revertedWith("TransferHelper: TRANSFER_FROM_FAILED");
    });

    it("should revert if last asset in path is incorrect", async function () {
      await expect(
        primexPricingLibraryMock.callStatic.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: parseUnits("1", await testTokenA.decimals()),
            routes: await getSingleRoute([testTokenA.address, testTokenX.address], dex),
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          1,
          primexDNS.address,
          priceOracle.address,
          true,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });

    it("should swap when path length > 2", async function () {
      const amountIn = parseUnits("2", await testTokenA.decimals());

      const amountOut = await getAmountsOut(dex, amountIn, [testTokenA.address, testTokenX.address, testTokenB.address]);

      expect(
        await primexPricingLibraryMock.callStatic.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: amountIn,
            routes: await getSingleRoute([testTokenA.address, testTokenX.address, testTokenB.address], dex, 1),
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          false,
        ),
      ).to.be.equal(amountOut);
    });

    it("should swap when path has different dexes", async function () {
      const amountIn = parseUnits("2", await testTokenA.decimals());

      const amountOutAB = await getAmountsOut(dex, amountIn, [testTokenA.address, testTokenX.address, testTokenB.address]);
      const amountOut = await getAmountsOut(dex2, amountOutAB, [testTokenB.address, testTokenX.address]);

      expect(
        await primexPricingLibraryMock.callStatic.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenX.address,
            amountTokenA: amountIn,
            routes: [
              {
                shares: 1,
                paths: [
                  {
                    dexName: dex,
                    encodedPath: await getEncodedPath([testTokenA.address, testTokenX.address, testTokenB.address], dex),
                  },
                  {
                    dexName: dex2,
                    encodedPath: await getEncodedPath([testTokenB.address, testTokenX.address], dex2),
                  },
                ],
              },
            ],
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          false,
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
        primexPricingLibraryMock.callStatic.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amountTokenA: parseUnits("1", await testTokenA.decimals()),
            routes: await getSingleRoute([testTokenA.address, testTokenB.address], dexName),
            dexAdapter: dexAdapter.address,
            receiver: trader.address,
            deadline: new Date().getTime() + 600,
          },
          1,
          primexDNS.address,
          priceOracle.address,
          true,
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
