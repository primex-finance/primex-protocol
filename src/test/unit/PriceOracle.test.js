// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getSigners,
    getContract,
    getContractFactory,
    utils: { parseUnits },
    constants: { Zero, AddressZero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockAccessControl, deployMockERC20, deployMockAggregatorV3Interface } = require("../utils/waffleMocks");
const { WAD, NATIVE_CURRENCY } = require("../utils/constants.js");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN } = require("../../Constants");
const { getAdminSigners } = require("../utils/hardhatUtils");

process.env.TEST = true;

describe("PriceOracle_unit", function () {
  let priceOracle, priceOracleFactory;
  let mockRegistry, mockPriceFeed, mockPriceDropFeed;
  let EmergencyAdmin, SmallTimelockAdmin;
  let tokenA, tokenB;
  let deployer, caller;
  let ErrorsLibrary;
  let snapshotId;

  before(async function () {
    await fixture(["Test"]);
    [deployer, caller] = await getSigners();
    ({ SmallTimelockAdmin, EmergencyAdmin } = await getAdminSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    priceOracleFactory = await getContractFactory("PriceOracle");
    ErrorsLibrary = await getContract("Errors");
    tokenA = await deployMockERC20(deployer);
    tokenB = await deployMockERC20(deployer);
    mockPriceFeed = await deployMockAggregatorV3Interface(deployer);
    mockPriceDropFeed = await deployMockAggregatorV3Interface(deployer);
  });

  beforeEach(async function () {
    priceOracle = await getContract("PriceOracle");
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
  describe("initialize", function () {
    it("Storage", async function () {
      expect(await priceOracle.eth()).to.equal(NATIVE_CURRENCY);
    });
    it("Should revert if registry does not support IAccessControl interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(priceOracleFactory, [mockRegistry.address, NATIVE_CURRENCY], { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("setPairPriceDrop", function () {
    const pairPriceDrop = "100000000000000000";
    it("Should setPairPriceDrop", async function () {
      await expect(priceOracle.connect(SmallTimelockAdmin).setPairPriceDrop(tokenB.address, tokenA.address, pairPriceDrop))
        .to.emit(priceOracle, "PairPriceDropChanged")
        .withArgs(tokenB.address, tokenA.address, pairPriceDrop);
      expect(await priceOracle.pairPriceDrops(tokenB.address, tokenA.address)).to.equal(BigNumber.from(WAD).div(10).toString());
    });

    it("Should revert if not SMALL_TIMELOCK_ADMIN call setPairPriceDrop", async function () {
      await expect(
        priceOracle.connect(caller).setPairPriceDrop(tokenB.address, tokenA.address, pairPriceDrop),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert when one of the assets is equal to zero", async function () {
      await expect(priceOracle.setPairPriceDrop(AddressZero, tokenA.address, pairPriceDrop)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ASSET_ADDRESS_NOT_SUPPORTED",
      );
      await expect(priceOracle.setPairPriceDrop(tokenB.address, AddressZero, pairPriceDrop)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ASSET_ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert when the asset addresses are identical", async function () {
      await expect(priceOracle.setPairPriceDrop(tokenA.address, tokenA.address, pairPriceDrop)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "IDENTICAL_ASSET_ADDRESSES",
      );
    });

    it("Should revert when pairPriceDrops is not correct", async function () {
      await expect(
        priceOracle.setPairPriceDrop(tokenB.address, tokenA.address, BigNumber.from(WAD.toString())),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "PAIR_PRICE_DROP_IS_NOT_CORRECT");
      await expect(priceOracle.setPairPriceDrop(tokenB.address, tokenA.address, Zero)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PAIR_PRICE_DROP_IS_NOT_CORRECT",
      );
    });
  });

  describe("increasePairPriceDrop", function () {
    let currentPairPriceDrop;
    before(async function () {
      currentPairPriceDrop = await priceOracle.pairPriceDrops(tokenB.address, tokenA.address);
    });

    it("Should increasePairPriceDrop", async function () {
      await expect(
        priceOracle
          .connect(EmergencyAdmin)
          .increasePairPriceDrop(tokenB.address, tokenA.address, currentPairPriceDrop.add(1), { gasLimit: 2000000 }),
      )
        .to.emit(priceOracle, "PairPriceDropChanged")
        .withArgs(tokenB.address, tokenA.address, currentPairPriceDrop.add(1));
      expect(await priceOracle.pairPriceDrops(tokenB.address, tokenA.address)).to.equal(currentPairPriceDrop.add(1));
    });

    it("Should revert if not EMERGENCY_ADMIN call increasePairPriceDrop", async function () {
      await expect(
        priceOracle.connect(caller).increasePairPriceDrop(tokenB.address, tokenA.address, currentPairPriceDrop.add(1)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert when one of the assets is equal to zero", async function () {
      await expect(
        priceOracle.increasePairPriceDrop(AddressZero, tokenA.address, currentPairPriceDrop.add(1)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_ADDRESS_NOT_SUPPORTED");
      await expect(
        priceOracle.increasePairPriceDrop(tokenB.address, AddressZero, currentPairPriceDrop.add(1)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ASSET_ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when the asset addresses are identical", async function () {
      await expect(
        priceOracle.increasePairPriceDrop(tokenA.address, tokenA.address, currentPairPriceDrop.add(1)),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "IDENTICAL_ASSET_ADDRESSES");
    });

    it("Should revert when pairPriceDrops is not correct", async function () {
      await expect(
        priceOracle.increasePairPriceDrop(tokenB.address, tokenA.address, BigNumber.from(WAD.toString()).div("2").add("1")), // i.e 50% + 1
      ).to.be.revertedWithCustomError(ErrorsLibrary, "PAIR_PRICE_DROP_IS_NOT_CORRECT");
      await expect(priceOracle.increasePairPriceDrop(tokenB.address, tokenA.address, currentPairPriceDrop)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PAIR_PRICE_DROP_IS_NOT_CORRECT",
      );
    });
  });

  describe("updatePriceFeed()", function () {
    it("Should revert not BIG_TIMELOCK_ADMIN call updatePriceFeed", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, deployer.address).returns(false);
      priceOracle = await upgrades.deployProxy(priceOracleFactory, [mockRegistry.address, NATIVE_CURRENCY], {
        unsafeAllow: ["constructor", "delegatecall"],
      });

      await expect(priceOracle.updatePriceFeed(tokenA.address, tokenB.address, mockPriceFeed.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert if token addresses in pair to add are identical", async function () {
      priceOracle = await upgrades.deployProxy(priceOracleFactory, [mockRegistry.address, NATIVE_CURRENCY], {
        unsafeAllow: ["constructor", "delegatecall"],
      });
      await expect(priceOracle.updatePriceFeed(tokenA.address, tokenA.address, mockPriceFeed.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "IDENTICAL_TOKEN_ADDRESSES",
      );
    });

    it("Should add a price feed if token addresses in pair are different", async function () {
      priceOracle = await upgrades.deployProxy(priceOracleFactory, [mockRegistry.address, NATIVE_CURRENCY], {
        unsafeAllow: ["constructor", "delegatecall"],
      });

      expect(await priceOracle.updatePriceFeed(tokenA.address, tokenB.address, mockPriceFeed.address));
      expect(tokenA.address).not.equal(tokenB.address);
    });

    it("Should emit PriceFeedUpdated when update is successful", async function () {
      await expect(priceOracle.updatePriceFeed(tokenA.address, tokenB.address, mockPriceFeed.address))
        .to.emit(priceOracle, "PriceFeedUpdated")
        .withArgs(tokenA.address, tokenB.address, mockPriceFeed.address);
    });
  });

  describe("getDirectPriceFeed()", function () {
    before(async function () {
      mockPriceFeed = await deployMockAggregatorV3Interface(deployer);
    });
    it("Should revert if token addresses in pair are identical", async function () {
      await expect(priceOracle.getDirectPriceFeed(tokenA.address, tokenA.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "IDENTICAL_TOKEN_ADDRESSES",
      );
    });

    it("Should revert if no price feed found", async function () {
      await expect(priceOracle.getDirectPriceFeed(tokenA.address, tokenB.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NO_PRICEFEED_FOUND",
      );
    });

    it("Should get a price feed if token addresses in pair are different and the price feed exists", async function () {
      await priceOracle.updatePriceFeed(tokenA.address, tokenB.address, mockPriceFeed.address);

      const actualPriceFeed = await priceOracle.getDirectPriceFeed(tokenA.address, tokenB.address);
      expect(mockPriceFeed.address).to.equal(actualPriceFeed);
    });
  });

  describe("getExchangeRate()", function () {
    it("tokenA/tokenB - price feed exists, direction = isForward, returns rate in 10**18 decimals", async function () {
      // setup aggregatorInterface
      const aggregatorInterface = await deployMockAggregatorV3Interface(deployer);
      const price = 200;
      await aggregatorInterface.mock.latestRoundData.returns([0], [price], [0], [0], [0]);
      await aggregatorInterface.mock.decimals.returns(0);

      // update price feed
      await priceOracle.updatePriceFeed(tokenA.address, tokenB.address, aggregatorInterface.address);

      // retrieve price and direction
      const [exchangeRate, direction] = await priceOracle.getExchangeRate(tokenA.address, tokenB.address);

      expect(exchangeRate).to.equal((price * Math.pow(10, 18)).toString());
      expect(direction).to.equal(true);
    });

    it("tokenB/tokenA - price feed exists, direction = !isForward, returns rate in 10**18 decimals", async function () {
      // setup aggregatorInterface
      const aggregatorInterface = await deployMockAggregatorV3Interface(deployer);
      const price = 200;
      await aggregatorInterface.mock.latestRoundData.returns([0], [price], [0], [0], [0]);
      await aggregatorInterface.mock.decimals.returns(0);

      // update price feed
      await priceOracle.updatePriceFeed(tokenB.address, tokenA.address, aggregatorInterface.address);

      // retrieve price and direction
      const [exchangeRate, direction] = await priceOracle.getExchangeRate(tokenA.address, tokenB.address);

      expect(exchangeRate).to.equal((price * Math.pow(10, 18)).toString());
      expect(direction).to.equal(false);
    });

    it("tokenA/tokenB - price feed does not exist, tokenA/eth - price feed exists, tokenB/eth - price feed exists, direction = isForward, returns rate in 10**18 decimals", async function () {
      const aggregatorInterfaceBaseTokenToEth = await deployMockAggregatorV3Interface(deployer);
      const price1 = 2;
      await aggregatorInterfaceBaseTokenToEth.mock.latestRoundData.returns([0], [price1], [0], [0], [0]);

      const aggregatorInterfaceQuoteTokenToEth = await deployMockAggregatorV3Interface(deployer);
      const price2 = 5;
      await aggregatorInterfaceQuoteTokenToEth.mock.latestRoundData.returns([0], [price2], [0], [0], [0]);

      await priceOracle.updatePriceFeed(tokenA.address, NATIVE_CURRENCY, aggregatorInterfaceBaseTokenToEth.address);
      await priceOracle.updatePriceFeed(tokenB.address, NATIVE_CURRENCY, aggregatorInterfaceQuoteTokenToEth.address);

      const [exchangeRate, direction] = await priceOracle.getExchangeRate(tokenA.address, tokenB.address);

      expect(exchangeRate).to.equal(((price1 / price2) * Math.pow(10, 18)).toString());
      expect(direction).to.equal(true);
    });

    it("should revert if basePrice from oracle is negative", async function () {
      const aggregatorInterfaceBaseTokenToEth = await deployMockAggregatorV3Interface(deployer);
      const price1 = -2;
      await aggregatorInterfaceBaseTokenToEth.mock.latestRoundData.returns([0], price1, [0], [0], [0]);

      const aggregatorInterfaceQuoteTokenToEth = await deployMockAggregatorV3Interface(deployer);
      const price2 = 5;
      await aggregatorInterfaceQuoteTokenToEth.mock.latestRoundData.returns([0], price2, [0], [0], [0]);

      await priceOracle.updatePriceFeed(tokenA.address, NATIVE_CURRENCY, aggregatorInterfaceBaseTokenToEth.address);
      await priceOracle.updatePriceFeed(tokenB.address, NATIVE_CURRENCY, aggregatorInterfaceQuoteTokenToEth.address);

      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_EXCHANGE_RATE",
      );
    });

    it("should revert if quotePrice from oracle is negative", async function () {
      const aggregatorInterfaceBaseTokenToEth = await deployMockAggregatorV3Interface(deployer);
      const price1 = 2;
      await aggregatorInterfaceBaseTokenToEth.mock.latestRoundData.returns(0, price1, 0, 0, 0);

      const aggregatorInterfaceQuoteTokenToEth = await deployMockAggregatorV3Interface(deployer);
      const price2 = -5;
      await aggregatorInterfaceQuoteTokenToEth.mock.latestRoundData.returns(0, price2, 0, 0, 0);

      await priceOracle.updatePriceFeed(tokenA.address, NATIVE_CURRENCY, aggregatorInterfaceBaseTokenToEth.address);
      await priceOracle.updatePriceFeed(tokenB.address, NATIVE_CURRENCY, aggregatorInterfaceQuoteTokenToEth.address);

      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_EXCHANGE_RATE",
      );
    });

    it("Should revert if no price feed found", async function () {
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NO_PRICEFEED_FOUND",
      );
    });
  });

  describe("updatePriceDropFeed()", function () {
    it("Should revert if msg.sender is not granted with a role MEDIUM_TIMELOCK_ADMIN", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(false);
      priceOracle = await upgrades.deployProxy(priceOracleFactory, [mockRegistry.address, NATIVE_CURRENCY], {
        unsafeAllow: ["constructor", "delegatecall"],
      });
      await expect(
        priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert if token addresses in pair to add are identical", async function () {
      await expect(
        priceOracle.updatePriceDropFeed(tokenA.address, tokenA.address, mockPriceDropFeed.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "IDENTICAL_TOKEN_ADDRESSES");
    });

    it("Should add a priceDrop feed if token addresses in pair are different", async function () {
      expect(await priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address));
      expect(tokenA.address).not.equal(tokenB.address);
    });

    it("Should emit PriceDropFeedUpdated when update is successful ", async function () {
      await expect(priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address))
        .to.emit(priceOracle, "PriceDropFeedUpdated")
        .withArgs(tokenA.address, tokenB.address, mockPriceDropFeed.address);
    });
  });

  describe("setGasPriceFeed", function () {
    it("Should emit GasPriceFeedChanged when set is successful", async function () {
      await expect(priceOracle.setGasPriceFeed(mockPriceFeed.address))
        .to.emit(priceOracle, "GasPriceFeedChanged")
        .withArgs(mockPriceFeed.address);
    });
  });

  describe("getOraclePriceDropFeed()", function () {
    it("Should revert if token addresses in pair are identical", async function () {
      await expect(priceOracle.getOraclePriceDropFeed(tokenA.address, tokenA.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "IDENTICAL_TOKEN_ADDRESSES",
      );
    });

    it("Should revert if no priceDrop feed found", async function () {
      await expect(priceOracle.getOraclePriceDropFeed(tokenA.address, tokenB.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NO_PRICE_DROP_FEED_FOUND",
      );
    });

    it("Should get a priceDrop feed if token addresses in pair are different and the price feed exists", async function () {
      await priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address);

      const actualPriceDropFeed = await priceOracle.getOraclePriceDropFeed(tokenA.address, tokenB.address);
      expect(mockPriceDropFeed.address).to.equal(actualPriceDropFeed);
    });
  });

  describe("getOraclePriceDrop", function () {
    it("Should return zero if no chainLink priceDrop feed", async function () {
      expect(await priceOracle.getOraclePriceDrop(tokenA.address, tokenB.address)).to.equal(0);
    });
    it("Should return correct value of pairPriceDrop from chainLink priceDrop feed in 10**18 decimals", async function () {
      const decimals = 5; // chainLinks decimals for pairPriceDrop
      const chainlinkPriceDrop = parseUnits("0.35", decimals.toString()); // 35%
      mockPriceDropFeed = await deployMockAggregatorV3Interface(deployer);
      await mockPriceDropFeed.mock.decimals.returns(decimals);
      await mockPriceDropFeed.mock.latestRoundData.returns([0], chainlinkPriceDrop, [0], [0], [0]);
      await priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address);
      const getOraclePriceDrop = await priceOracle.getOraclePriceDrop(tokenA.address, tokenB.address);

      expect(getOraclePriceDrop).to.equal((chainlinkPriceDrop * Math.pow(10, 18 - decimals)).toString());
    });
  });
  describe("getPairPriceDrop", function () {
    it("Should return hardcoded value of pairPriceDrop when pairPriceDrop >= oraclePairPriceDrop", async function () {
      const decimals = 5; // chainLinks decimals for pairPriceDrop
      const chainlinkPriceDrop = parseUnits("0.35", decimals.toString()); // 35%
      const pairPriceDrop = parseUnits("0.36", "18"); // 36%
      mockPriceDropFeed = await deployMockAggregatorV3Interface(deployer);
      await mockPriceDropFeed.mock.decimals.returns(decimals);
      await mockPriceDropFeed.mock.latestRoundData.returns([0], chainlinkPriceDrop, [0], [0], [0]);
      await priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address);
      await priceOracle.getOraclePriceDrop(tokenA.address, tokenB.address);
      await priceOracle.setPairPriceDrop(tokenA.address, tokenB.address, pairPriceDrop);

      expect(await priceOracle.getPairPriceDrop(tokenA.address, tokenB.address)).to.equal(pairPriceDrop);
    });

    it("Should return oraclePairPriceDrop when pairPriceDrop < oraclePairPriceDrop", async function () {
      const decimals = 5; // chainLinks decimals for pairPriceDrop
      const chainlinkPriceDrop = parseUnits("0.35", decimals.toString()); // 35%
      const pairPriceDrop = parseUnits("0.34", "18"); // 34%
      mockPriceDropFeed = await deployMockAggregatorV3Interface(deployer);
      await mockPriceDropFeed.mock.decimals.returns(decimals);
      await mockPriceDropFeed.mock.latestRoundData.returns([0], chainlinkPriceDrop, [0], [0], [0]);
      await priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address);
      await priceOracle.getOraclePriceDrop(tokenA.address, tokenB.address);
      await priceOracle.setPairPriceDrop(tokenA.address, tokenB.address, pairPriceDrop);
      expect(await priceOracle.getPairPriceDrop(tokenA.address, tokenB.address)).to.equal(
        (chainlinkPriceDrop * Math.pow(10, 18 - decimals)).toString(),
      );
    });

    it("Should return one (in WAD format) when priceDropRate > 1", async function () {
      const decimals = 5; // chainLinks decimals for pairPriceDrop
      const chainlinkPriceDrop = parseUnits("1.1", decimals.toString()); // 110%
      const pairPriceDrop = parseUnits("0.34", "18"); // 34%
      mockPriceDropFeed = await deployMockAggregatorV3Interface(deployer);
      await mockPriceDropFeed.mock.decimals.returns(decimals);
      await mockPriceDropFeed.mock.latestRoundData.returns([0], chainlinkPriceDrop, [0], [0], [0]);
      await priceOracle.updatePriceDropFeed(tokenA.address, tokenB.address, mockPriceDropFeed.address);
      await priceOracle.getOraclePriceDrop(tokenA.address, tokenB.address);
      await priceOracle.setPairPriceDrop(tokenA.address, tokenB.address, pairPriceDrop);
      expect(await priceOracle.getPairPriceDrop(tokenA.address, tokenB.address)).to.equal(WAD);
    });
  });
});
