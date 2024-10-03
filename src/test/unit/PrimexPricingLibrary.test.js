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
const { deployMockPriceOracle, deployMockDexAdapter, deployMockBucket } = require("../utils/waffleMocks");
const { getSingleMegaRoute } = require("../utils/dexOperations");

process.env.TEST = true;

describe("PrimexPricingLibrary_unit", function () {
  let snapshotId;
  let dex, primexPricingLibrary, primexDNS, primexPricingLibraryMock, testTokenA, decimalsA, testTokenB, decimalsB;
  let priceOracle, dexAdapter, bucket;
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
    primexDNS = await getContract("PrimexDNS");

    [priceOracle] = await deployMockPriceOracle(deployer);
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
        primexPricingLibraryMock.getOracleAmountsOut(testTokenA.address, testTokenB.address, 1, priceOracle.address, 0),
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
          0,
        ),
      ).to.equal(amountAssetA);
    });

    it("Should return amount according to exchange rate", async function () {
      const exchangeRate = "2";
      await priceOracle.mock.getExchangeRate.returns(parseEther(exchangeRate));
      const amountAssetA = parseUnits("2", decimalsA);

      const amountWithoutAdecimals = formatUnits(amountAssetA, decimalsA);
      const amountInBdecimals = parseUnits(amountWithoutAdecimals, decimalsB);
      expect(
        await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
          testTokenA.address,
          testTokenB.address,
          amountAssetA,
          priceOracle.address,
          0,
        ),
      ).to.equal(amountInBdecimals.mul(exchangeRate));
    });
  });

  describe("getDepositAmountInBorrowed", function () {
    let amountToConvert;
    before(async function () {
      amountToConvert = parseUnits("1", decimalsA);
    });

    it("Should revert if priceOracle does not support IPriceOracle interface", async function () {
      await priceOracle.mock.supportsInterface.returns(false);
      await expect(
        primexPricingLibraryMock.getDepositAmountInBorrowed(
          {
            tokenA: testTokenA.address,
            tokenB: testTokenB.address,
            amount: amountToConvert,
            megaRoutes: [],
          },
          false,
          dexAdapter.address,
          priceOracle.address,
          0,
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
            megaRoutes: await getSingleMegaRoute([testTokenA.address, testTokenA.address], dex),
          },
          false,
          dexAdapter.address,
          priceOracle.address,
          0,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DEPOSITED_TO_BORROWED_ROUTES_LENGTH_SHOULD_BE_0");
    });
  });

  describe("getLiquidationPrice", function () {
    it("Should revert if positionAsset is zero address", async function () {
      await expect(
        primexPricingLibraryMock.getLiquidationPrice(
          bucket.address,
          AddressZero,
          parseUnits("1", decimalsB),
          parseUnits("1", decimalsA),
          primexDNS.address,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
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
