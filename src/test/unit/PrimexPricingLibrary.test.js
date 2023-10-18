// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits, formatUnits },
    constants: { AddressZero },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockPriceOracle, deployMockPrimexDNS, deployMockDexAdapter, deployMockBucket } = require("../utils/waffleMocks");
const { getEncodedPath } = require("../utils/dexOperations");

process.env.TEST = true;

describe("PrimexPricingLibrary_unit", function () {
  let snapshotId;
  let dex, primexPricingLibrary, primexPricingLibraryMock, testTokenA, decimalsA, testTokenB, decimalsB;
  let priceOracle, primexDNS, dexAdapter, bucket;
  let deployer, trader;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    ErrorsLibrary = await getContract("Errors");
    decimalsB = await testTokenB.decimals();

    primexPricingLibrary = await getContract("PrimexPricingLibrary");

    [priceOracle] = await deployMockPriceOracle(deployer);
    primexDNS = await deployMockPrimexDNS(deployer);
    dexAdapter = await deployMockDexAdapter(deployer);
    bucket = await deployMockBucket(deployer);

    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }
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

  describe("getOracleAmountsOut", function () {
    it("Should revert if priceOracle does not support IPriceOracle interface", async function () {
      await priceOracle.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.getOracleAmountsOut(testTokenA.address, testTokenB.address, 1, priceOracle.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should return amountAssetA if tokens are identical", async function () {
      const amountAssetA = parseUnits("2", decimalsA).toString();
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testTokenA.address,
          testTokenA.address,
          amountAssetA,
          priceOracle.address,
        ),
      ).to.equal(amountAssetA);
    });

    it("Should return amount according to exchange rate", async function () {
      const exchangeRate = "2";
      await priceOracle.mock.getExchangeRate.returns(parseEther(exchangeRate), true);
      const amountAssetA = parseUnits("2", decimalsA);

      const amountWithoutAdecimals = formatUnits(amountAssetA, decimalsA);
      const amountInBdecimals = parseUnits(amountWithoutAdecimals, decimalsB);
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testTokenA.address,
          testTokenB.address,
          amountAssetA,
          priceOracle.address,
        ),
      ).to.equal(amountInBdecimals.mul(exchangeRate));
    });
  });

  describe("getAmountOut", function () {
    let amountToConvert;
    before(async function () {
      amountToConvert = parseUnits("1", decimalsA);
    });

    it("Should revert when assets are identical", async function () {
      await expect(
        primexPricingLibraryMock.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenA.address,
          amount: amountToConvert,
          routes: [],
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "IDENTICAL_ASSETS");
    });
    it("Should revert when _routes is empty list", async function () {
      await expect(
        primexPricingLibraryMock.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: amountToConvert,
          routes: [],
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });
    it("Should revert if primexDNS does not support IPrimexDNS interface", async function () {
      await primexDNS.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.getAmountOut({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amount: amountToConvert,
          routes: [],
          dexAdapter: dexAdapter.address,
          primexDNS: primexDNS.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("getDepositAmountInBorrowed", function () {
    let amountToConvert;
    before(async function () {
      amountToConvert = parseUnits("1", decimalsA);
    });

    it("Should revert if primexDNS does not support IPrimexDNS interface", async function () {
      await primexDNS.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.getDepositAmountInBorrowed(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amount: amountToConvert,
            routes: [],
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
          },
          false,
          priceOracle.address,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if priceOracle does not support IPriceOracle interface", async function () {
      await priceOracle.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.getDepositAmountInBorrowed(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amount: amountToConvert,
            routes: [],
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
          },
          false,
          priceOracle.address,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert assets are identical and routes is not empty", async function () {
      await expect(
        primexPricingLibraryMock.getDepositAmountInBorrowed(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenA.address,
            amount: amountToConvert,
            routes: [
              {
                shares: 1,
                paths: [
                  {
                    dexName: dex,
                    encodedPath: await getEncodedPath([testTokenA.address, testTokenA.address], dex),
                  },
                ],
              },
            ],
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
          },
          false,
          priceOracle.address,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSITED_TO_BORROWED_ROUTES_LENGTH_SHOULD_BE_0");
    });
  });

  describe("multiSwap", function () {
    let amountToConvert;
    before(async function () {
      amountToConvert = parseUnits("1", decimalsA);
    });

    it("Should revert if primexDNS does not support IPrimexDNS interface", async function () {
      await primexDNS.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenA.address,
            amountTokenA: amountToConvert,
            routes: [
              {
                shares: 1,
                paths: [
                  {
                    dexName: dex,
                    encodedPath: await getEncodedPath([testTokenA.address, testTokenA.address], dex),
                  },
                ],
              },
            ],
            dexAdapter: dexAdapter.address,
            receiver: AddressZero,
            deadline: 0,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          false,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if priceOracle does not support IPriceOracle interface", async function () {
      await priceOracle.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenA.address,
            amountTokenA: amountToConvert,
            routes: [
              {
                shares: 1,
                paths: [
                  {
                    dexName: dex,
                    encodedPath: await getEncodedPath([testTokenA.address, testTokenA.address], dex),
                  },
                ],
              },
            ],
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
            receiver: AddressZero,
            deadline: 0,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          true,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if routes length is 0", async function () {
      await expect(
        primexPricingLibraryMock.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenA.address,
            amountTokenA: amountToConvert,
            routes: [],
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
            receiver: AddressZero,
            deadline: 0,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          false,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });
    it("Should revert if sum of shares is 0", async function () {
      await expect(
        primexPricingLibraryMock.multiSwap(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenA.address,
            amountTokenA: amountToConvert,
            routes: [
              {
                shares: 0,
                paths: [
                  {
                    dexName: dex,
                    encodedPath: await getEncodedPath([testTokenA.address, testTokenA.address], dex),
                  },
                ],
              },
            ],
            dexAdapter: dexAdapter.address,
            primexDNS: primexDNS.address,
            receiver: AddressZero,
            deadline: 0,
          },
          0,
          primexDNS.address,
          priceOracle.address,
          false,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });
  });

  describe("getLiquidationPrice", function () {
    it("Should revert if positionAsset is zero address", async function () {
      await expect(
        primexPricingLibraryMock.getLiquidationPrice(bucket.address, AddressZero, parseUnits("1", decimalsB), parseUnits("1", decimalsA)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if positionAsset is not allowed", async function () {
      await bucket.mock.allowedAssets.returns(0, false);
      await expect(
        primexPricingLibraryMock.getLiquidationPrice(
          bucket.address,
          testTokenA.address,
          parseUnits("1", decimalsB),
          parseUnits("1", decimalsA),
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
    });
  });

  describe("getLiquidationPriceByOrder", function () {
    it("Should revert if positionAsset is zero address", async function () {
      await expect(
        primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucket.address,
          AddressZero,
          parseUnits("1", decimalsA),
          parseUnits("1", decimalsA),
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if positionAsset is not allowed", async function () {
      await bucket.mock.allowedAssets.returns(0, false);
      await expect(
        primexPricingLibraryMock.getLiquidationPriceByOrder(
          bucket.address,
          testTokenA.address,
          parseUnits("1", decimalsA),
          parseUnits("2", decimalsA),
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TOKEN_NOT_SUPPORTED");
    });
  });
});
