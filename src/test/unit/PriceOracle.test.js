// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    provider,
    getSigners,
    getContract,
    getContractFactory,
    utils: { parseUnits, parseEther },
    constants: { Zero, AddressZero, HashZero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");
const {
  deployMockAccessControl,
  deployMockERC20,
  deployMockUniswapPriceFeed,
  deployMockAggregatorV3Interface,
  deployMockPyth,
  deployMockOrally,
  deployMockStork,
  deploySupraPullMock,
  deploySupraStoragelMock,
  deployMockTreasury,
  deployMockCurvePriceFeed,
  deployMockERC4626,
  deployMockUniswapV2LPOracle,
} = require("../utils/waffleMocks");
const {
  getEncodedRoutes,
  getEncodedStorkOracleData,
  getEncodedCurveLTOracleData,
  getEncodedUniswapV2LPOracleData,
} = require("../utils/oracleUtils");

const { WAD, NATIVE_CURRENCY, USD, CurveOracleKind } = require("../utils/constants.js");
const { MEDIUM_TIMELOCK_ADMIN } = require("../../Constants");
const { getAdminSigners } = require("../utils/hardhatUtils");
const { ZERO_BYTES_32, ZERO_ADDRESS } = require("@aave/deploy-v3");
const { wadDiv, wadMul } = require("../utils/bnMath");

const { OracleType } = require("../utils/constants.js");

process.env.TEST = true;

describe("PriceOracle_unit", function () {
  let priceOracle, priceOracleFactory;
  let mockRegistry,
    mockPriceFeed,
    mockOrally,
    mockPriceDropFeed,
    mockUniswapPriceFeed,
    mockCurvePriceFeed,
    mockTreasury,
    mockPyth,
    supraPullMock,
    mockStork,
    mockEIP4626,
    mockEIP4626Underlying,
    mockUniswapV2LPOracle,
    supraStorageMock;
  let EmergencyAdmin, SmallTimelockAdmin;
  let tokenA, tokenB;
  let deployer, caller;
  let ErrorsLibrary;
  let snapshotId;
  const NOT_ZERO_BYTES = "0x0000000000000000000000000000000000000000000000000000000000000001";

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
    mockUniswapPriceFeed = await deployMockUniswapPriceFeed(deployer);
    mockCurvePriceFeed = await deployMockCurvePriceFeed(deployer);
    mockPyth = await deployMockPyth(deployer);
    mockOrally = await deployMockOrally(deployer);
    mockStork = await deployMockStork(deployer);
    supraPullMock = await deploySupraPullMock(deployer);
    supraStorageMock = await deploySupraStoragelMock(deployer);
    mockTreasury = await deployMockTreasury(deployer);
    mockEIP4626 = await deployMockERC4626(deployer);
    mockEIP4626Underlying = await deployMockERC20(deployer);
    mockUniswapV2LPOracle = await deployMockUniswapV2LPOracle(deployer);
    await mockEIP4626.mock.asset.returns(mockEIP4626Underlying.address);
  });

  beforeEach(async function () {
    priceOracle = await getContract("PriceOracle");
    await priceOracle.setUniswapV2LPOracle(mockUniswapV2LPOracle.address);
    await priceOracle.updateUniv3TypeOracle([0], [mockUniswapPriceFeed.address]);
    await priceOracle.setPyth(mockPyth.address);
    await priceOracle.setOrallyOracle(mockOrally.address);
    await priceOracle.setSupraPullOracle(supraPullMock.address);
    await priceOracle.setSupraStorageOracle(supraStorageMock.address);
    await priceOracle.setTimeTolerance("60");
    await priceOracle.setStorkVerify(mockStork.address);
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
        upgrades.deployProxy(priceOracleFactory, [mockRegistry.address, NATIVE_CURRENCY, tokenA.address, mockTreasury.address], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
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
  describe("setPyth", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setPyth", async function () {
      await expect(priceOracle.connect(caller).setPyth(mockPyth.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully setPyth", async function () {
      expect(await priceOracle.setPyth(tokenA.address));
      expect(await priceOracle.pyth()).to.be.equal(tokenA.address);
    });
  });
  describe("setOrallyOracle", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setOrallyOracle", async function () {
      await expect(priceOracle.connect(caller).setOrallyOracle(mockOrally.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully setOrallyOracle", async function () {
      expect(await priceOracle.setOrallyOracle(mockOrally.address));
      expect(await priceOracle.orallyOracle()).to.be.equal(mockOrally.address);
    });
  });
  describe("setStorkPublicKey", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setStorkPublicKey", async function () {
      await expect(priceOracle.connect(caller).setStorkPublicKey(mockStork.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully setStorkPublicKey", async function () {
      expect(await priceOracle.setStorkPublicKey(mockStork.address));
      expect(await priceOracle.storkPublicKey()).to.be.equal(mockStork.address);
    });
  });
  describe("setStorkVerify", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setStorkVerify", async function () {
      await expect(priceOracle.connect(caller).setStorkVerify(mockStork.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully setStorkVerify", async function () {
      expect(await priceOracle.setStorkVerify(mockStork.address));
      expect(await priceOracle.storkVerify()).to.be.equal(mockStork.address);
    });
  });
  describe("setTreasury", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setTreasury", async function () {
      await expect(priceOracle.connect(caller).setTreasury(mockTreasury.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if registry does not support ITreasury interface", async function () {
      await mockTreasury.mock.supportsInterface.returns(false);
      await expect(priceOracle.setTreasury(mockTreasury.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should successfully setTreasury", async function () {
      expect(await priceOracle.setTreasury(mockTreasury.address));
      expect(await priceOracle.treasury()).to.be.equal(mockTreasury.address);
    });
  });
  describe("setSupraPullOracle", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setSupraPullOracle", async function () {
      await expect(priceOracle.connect(caller).setSupraPullOracle(supraPullMock.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully setSupraPullOracle", async function () {
      expect(await priceOracle.setSupraPullOracle(supraPullMock.address));
      expect(await priceOracle.supraPullOracle()).to.be.equal(supraPullMock.address);
    });
  });
  describe("setSupraStorageOracle", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setSupraStorageOracle", async function () {
      await expect(priceOracle.connect(caller).setSupraStorageOracle(supraStorageMock.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully setSupraPullOracle", async function () {
      expect(await priceOracle.setSupraStorageOracle(supraStorageMock.address));
      expect(await priceOracle.supraStorageOracle()).to.be.equal(supraStorageMock.address);
    });
  });
  describe("setTimeTolerance", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call setTimeTolerance", async function () {
      await expect(priceOracle.connect(caller).setTimeTolerance("10")).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully setPyth", async function () {
      expect(await priceOracle.setTimeTolerance("10"));
      expect(await priceOracle.timeTolerance()).to.be.equal("10");
    });
  });

  describe("setUniswapV2LPOracle", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setUniswapV2LPOracle", async function () {
      await expect(priceOracle.connect(caller).setUniswapV2LPOracle(mockUniswapV2LPOracle.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully setUniswapV2LPOracle", async function () {
      expect(await priceOracle.setUniswapV2LPOracle(mockUniswapV2LPOracle.address));
      expect(await priceOracle.uniswapV2LPOracle()).to.be.equal(mockUniswapV2LPOracle.address);
    });
  });

  describe("addUniswapV2LPTokens", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call addUniswapV2LPTokens", async function () {
      await expect(priceOracle.connect(caller).addUniswapV2LPTokens([tokenA.address])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully addUniswapV2LPTokens", async function () {
      expect(await priceOracle.addUniswapV2LPTokens([tokenA.address]));
      expect(await priceOracle.isUniswapV2LP(tokenA.address)).to.be.equal(true);
    });
  });
  describe("removeUniswapV2LPTokens", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call addUniswapV2LPTokens", async function () {
      await expect(priceOracle.connect(caller).removeUniswapV2LPTokens([tokenA.address])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should successfully removeUniswapV2LPTokens", async function () {
      await priceOracle.addUniswapV2LPTokens([tokenA.address]);
      expect(await priceOracle.removeUniswapV2LPTokens([tokenA.address]));
      expect(await priceOracle.isUniswapV2LP(tokenA.address)).to.be.equal(false);
    });
  });
  describe("updateChainlinkPriceFeedsUsd", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateChainlinkPriceFeedsUsd", async function () {
      await expect(
        priceOracle.connect(caller).updateChainlinkPriceFeedsUsd([tokenA.address], [mockPriceFeed.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if param lengths don't match", async function () {
      await expect(priceOracle.updateChainlinkPriceFeedsUsd([tokenA.address], [])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });
    it("Should successfully updateChainlinkPriceFeedsUsd", async function () {
      expect(await priceOracle.updateChainlinkPriceFeedsUsd([tokenA.address], [mockPriceFeed.address]));
      expect(await priceOracle.chainlinkPriceFeedsUsd(tokenA.address)).to.be.equal(mockPriceFeed.address);
    });
  });
  describe("updatePythPairId", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updatePythPairId", async function () {
      await expect(priceOracle.connect(caller).updatePythPairId([tokenA.address], [ZERO_BYTES_32])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if param lengths don't match", async function () {
      await expect(priceOracle.updatePythPairId([tokenA.address], [])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });
    it("Should successfully updatePythPairId", async function () {
      expect(await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]));
      expect(await priceOracle.pythPairIds(tokenA.address)).to.be.equal(NOT_ZERO_BYTES);
    });
  });
  describe("updateEIP4626TokenToUnderlyingAsset", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateEIP4626TokenToUnderlyingAsset", async function () {
      await expect(
        priceOracle.connect(caller).updateEIP4626TokenToUnderlyingAsset([tokenA.address], [tokenB.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if param lengths don't match", async function () {
      await expect(priceOracle.updateEIP4626TokenToUnderlyingAsset([tokenA.address], [])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });
    it("Should successfully updateEIP4626TokenToUnderlyingAsset", async function () {
      expect(await priceOracle.updateEIP4626TokenToUnderlyingAsset([tokenA.address], [tokenB.address]));
      expect(await priceOracle.eip4626TokenToUnderlyingAsset(tokenA.address)).to.be.equal(tokenB.address);
    });
  });
  describe("updateOrallySymbols", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateOrallySymbols", async function () {
      await expect(
        priceOracle.connect(caller).updateOrallySymbols([
          {
            symbol: "TOKENA_USD",
            tokens: [tokenA.address, USD],
          },
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully updateOrallySymbols", async function () {
      expect(
        await priceOracle.updateOrallySymbols([
          {
            symbol: "TOKENA_USD",
            tokens: [tokenA.address, USD],
          },
        ]),
      );
      expect(await priceOracle.orallySymbol(tokenA.address, USD)).to.be.equal("TOKENA_USD");
    });
  });
  describe("updateStorkPairIds", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateStorkPairIds", async function () {
      await expect(
        priceOracle.connect(caller).updateStorkPairIds([
          {
            pair: "TOKENAUSD",
            tokens: [tokenA.address, USD],
          },
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully updateStorkPairIds", async function () {
      expect(
        await priceOracle.updateStorkPairIds([
          {
            pair: "TOKENAUSD",
            tokens: [tokenA.address, USD],
          },
        ]),
      );
      expect(await priceOracle.storkAssetPairId(tokenA.address, USD)).to.be.equal("TOKENAUSD");
    });
  });
  describe("updateSupraDataFeed", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateSupraDataFeed", async function () {
      await expect(
        priceOracle.connect(caller).updateSupraDataFeed([
          {
            tokenA: tokenA.address,
            tokenB: tokenB.address,
            feedData: {
              id: 0,
              initialize: true,
            },
          },
        ]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully updateSupraDataFeed", async function () {
      expect(
        await priceOracle.updateSupraDataFeed([
          {
            tokenA: tokenA.address,
            tokenB: tokenB.address,
            feedData: {
              id: 0,
              initialize: true,
            },
          },
        ]),
      );
      const feedData = await priceOracle.supraDataFeedID(tokenA.address, tokenB.address);
      expect(feedData.id).to.be.equal(0);
      expect(feedData.initialize).to.be.equal(true);
    });
  });
  describe("updateUniv3TypeOracle", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateUniv3TypeOracle", async function () {
      await expect(priceOracle.connect(caller).updateUniv3TypeOracle([1], [mockUniswapPriceFeed.address])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if param lengths don't match", async function () {
      await expect(priceOracle.updateUniv3TypeOracle([1], [])).to.be.revertedWithCustomError(ErrorsLibrary, "PARAMS_LENGTH_MISMATCH");
    });
    it("Should successfully updateUniv3TypeOracle", async function () {
      expect(await priceOracle.updateUniv3TypeOracle([1], [mockUniswapPriceFeed.address]));
      expect(await priceOracle.univ3TypeOracles(1)).to.be.equal(mockUniswapPriceFeed.address);
    });
  });
  describe("updateUniv3TrustedPair", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call updateUniv3TrustedPair", async function () {
      const params = {
        oracleType: 0,
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        isTrusted: true,
      };
      await expect(priceOracle.connect(caller).updateUniv3TrustedPair([params])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should successfully updateUniv3TrustedPair", async function () {
      const params = {
        oracleType: 0,
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        isTrusted: true,
      };
      expect(await priceOracle.updateUniv3TrustedPair([params]));
      expect(await priceOracle.univ3TrustedPairs(params.oracleType, params.tokenA, params.tokenB)).to.be.equal(true);
      expect(await priceOracle.univ3TrustedPairs(params.oracleType, params.tokenB, params.tokenA)).to.be.equal(true);
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

  describe("getExchangeRate", function () {
    it("Should revert if the length of oracleRoutes is 0", async function () {
      const oracleData = getEncodedRoutes([]);
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "WRONG_ORACLE_ROUTES_LENGTH",
      );
    });
    it("Should revert if the tokenTo is incorrect", async function () {
      const oracleData = getEncodedRoutes([[tokenA.address, OracleType.Pyth, "0x"]]);
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_TOKEN_TO",
      );
    });
    it("Should revert if the length of oracleRoutes is more than 4", async function () {
      const oracleData = getEncodedRoutes(Array(5).fill([tokenB.address, OracleType.Pyth, "0x"]));
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "WRONG_ORACLE_ROUTES_LENGTH",
      );
    });
    it("Should revert if the routes sequence is incorrect when length is 3", async function () {
      let oracleData = Array(3).fill([tokenB.address, OracleType.Pyth, "0x"]);
      // second route is uniswapv3
      oracleData[1] = [tokenA.address, OracleType.Uniswapv3, "0x"];
      oracleData = getEncodedRoutes(oracleData);
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_ROUTE_SEQUENCE",
      );
    });
    it("Should revert if the routes sequence is incorrect when length is 4", async function () {
      const oracleData = [
        [tokenB.address, OracleType.Uniswapv3, "0x"],
        [tokenB.address, OracleType.Pyth, "0x"],
        [tokenB.address, OracleType.Chainlink, "0x"],
        [tokenB.address, OracleType.Chainlink, "0x"],
      ];
      oracleData[0] = [tokenB.address, OracleType.Pyth, "0x"];
      // first route is the Pyth
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, getEncodedRoutes(oracleData))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_ROUTE_SEQUENCE",
      );
      oracleData[0] = [tokenB.address, OracleType.Chainlink, "0x"];
      // first route is the Chainlink
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, getEncodedRoutes(oracleData))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_ROUTE_SEQUENCE",
      );
      oracleData[0] = [tokenB.address, OracleType.Uniswapv3, "0x"];
      // second route is the Uniswapv3
      oracleData[1] = [tokenB.address, OracleType.Uniswapv3, "0x"];
      await expect(priceOracle.getExchangeRate(tokenB.address, tokenB.address, getEncodedRoutes(oracleData))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_ROUTE_SEQUENCE",
      );
    });
    it("Should revert when the oracle route is the Pyth and there is no a price feed for the token", async function () {
      const oracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
      await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "NO_PRICEFEED_FOUND",
      );
    });
    it("Should revert when the tokenTo in the Pyth route is incorrect", async function () {
      await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]);
      const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Pyth, "0x"]]);
      await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PYTH_ROUTE",
      );
    });
    it("Should revert when the oracle route is the Pyth and the return price is incorrect", async function () {
      const oracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
      await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]);
      // price is negative
      await mockPyth.mock.getPrice.returns({ price: -1, conf: 0, expo: -8, publishTime: (await provider.getBlock("latest")).timestamp });
      await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PYTH_PRICE",
      );
      // expo is positiive
      await mockPyth.mock.getPrice.returns({ price: 1, conf: 0, expo: 8, publishTime: (await provider.getBlock("latest")).timestamp });
      await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PYTH_PRICE",
      );
      // expo is very negative
      await mockPyth.mock.getPrice.returns({ price: 1, conf: 0, expo: -266, publishTime: (await provider.getBlock("latest")).timestamp });
      await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PYTH_PRICE",
      );
    });
    it("Should revert when the publishTime exceeds the time tolerance", async function () {
      const oracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
      await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]);
      const price = BigNumber.from("2500");
      const expo = -8;
      const expoPrice = price.mul(BigNumber.from("10").pow(expo * -1));
      // price is negative
      await mockPyth.mock.getPrice.returns({
        price: expoPrice,
        conf: 0,
        expo: expo,
        publishTime: (await provider.getBlock("latest")).timestamp - 70,
      });
      await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PUBLISH_TIME_EXCEEDS_THRESHOLD_TIME",
      );
    });
    it("Should return correct amount when the price struct is empty", async function () {
      const oracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
      await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]);
      // price is negative
      await mockPyth.mock.getPrice.returns({ price: 0, conf: 0, expo: 0, publishTime: (await provider.getBlock("latest")).timestamp });
      // expo is positiive
      const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
      expect(amount).to.be.equal(0);
    });
    it("Should return correct amount when tokenA is not the usd", async function () {
      const oracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
      await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]);
      const price = BigNumber.from("2500");
      const expo = -8;
      const expoPrice = price.mul(BigNumber.from("10").pow(expo * -1));
      // price is negative
      await mockPyth.mock.getPrice.returns({
        price: expoPrice,
        conf: 0,
        expo: expo,
        publishTime: (await provider.getBlock("latest")).timestamp,
      });
      const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
      // price in wad
      expect(amount).to.be.equal(price.mul(BigNumber.from("10").pow("18")));
    });

    describe("getExchangeRate when oracle is Orally", function () {
      before(async function () {
        await priceOracle.setOrallyTimeTolerance("60");
      });
      it("Should revert when the oracle route is the Orally and there is no a symbol for the token", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.Orally, "0x"]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_TOKEN_SYMBOL_FOUND",
        );
      });
      it("Should revert when the oracle route is the Orally and the return price is incorrect", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.Orally, "0x"]]);
        await priceOracle.updateOrallySymbols([
          {
            symbol: "TOKEN/USD",
            tokens: [tokenA.address, USD],
          },
        ]);
        // price is negative
        await mockOrally.mock.getPriceFeed.returns({ pairId: "TOKEN/USD", price: 0, decimals: 0, timestamp: 0 });
        await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INCORRECT_ORALLY_PRICE",
        );
      });
      it("Should revert when the publishTime exceeds the time tolerance", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.Orally, "0x"]]);
        await priceOracle.updateOrallySymbols([
          {
            symbol: "TOKEN/USD",
            tokens: [tokenA.address, USD],
          },
        ]);
        const price = BigNumber.from("2500").mul(BigNumber.from("10").pow("6"));
        // price is negative
        await mockOrally.mock.getPriceFeed.returns({
          pairId: "TOKEN/USD",
          price: price,
          decimals: 6,
          timestamp: (await provider.getBlock("latest")).timestamp - 70,
        });

        await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "PUBLISH_TIME_EXCEEDS_THRESHOLD_TIME",
        );
      });
      it("Should return correct amount when tokenA is the usd", async function () {
        const oracleData = getEncodedRoutes([[tokenA.address, OracleType.Orally, "0x"]]);
        const decimals = 6;
        await priceOracle.updateOrallySymbols([
          {
            symbol: "TOKEN/USD",
            tokens: [tokenA.address, USD],
          },
        ]);
        const price = BigNumber.from("2500").mul(BigNumber.from("10").pow(decimals));
        await mockOrally.mock.getPriceFeed.returns({
          pairId: "TOKEN/USD",
          price: price,
          decimals: decimals,
          timestamp: (await provider.getBlock("latest")).timestamp,
        });
        const amount = await priceOracle.callStatic.getExchangeRate(USD, tokenA.address, oracleData);
        // price in wad
        expect(amount).to.be.equal(wadDiv(WAD, price.mul(BigNumber.from("10").pow(18 - decimals)).toString()));
      });
      it("Should return correct amount when tokenA is not the usd", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.Orally, "0x"]]);
        const decimals = 6;
        await priceOracle.updateOrallySymbols([
          {
            symbol: "TOKEN/USD",
            tokens: [tokenA.address, USD],
          },
        ]);
        const price = BigNumber.from("2500").mul(BigNumber.from("10").pow(decimals));
        await mockOrally.mock.getPriceFeed.returns({
          pairId: "TOKEN/USD",
          price: price,
          decimals: decimals,
          timestamp: (await provider.getBlock("latest")).timestamp,
        });
        const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
        // price in wad
        expect(amount).to.be.equal(price.mul(BigNumber.from("10").pow(18 - decimals)));
      });
    });

    describe("getExchangeRate when oracle is Stork", function () {
      it("Should revert when the oracle route is the Orally and there is no a symbol for the token", async function () {
        const oracleData = getEncodedRoutes([
          [
            USD,
            OracleType.Stork,
            getEncodedStorkOracleData(
              (await provider.getBlock("latest")).timestamp,
              BigNumber.from("2500").mul(BigNumber.from("10").pow("18")),
              HashZero,
              HashZero,
              0,
            ),
          ],
        ]);
        await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_TOKEN_PAIR_FOUND",
        );
      });
      it("Should revert when the publishTime exceeds the time tolerance", async function () {
        const oracleData = getEncodedRoutes([
          [
            USD,
            OracleType.Stork,
            getEncodedStorkOracleData(
              (await provider.getBlock("latest")).timestamp - 70,
              BigNumber.from("2500").mul(BigNumber.from("10").pow("18")),
              HashZero,
              HashZero,
              0,
            ),
          ],
        ]);
        await priceOracle.updateStorkPairIds([
          {
            pair: "TOKENAUSD",
            tokens: [tokenA.address, USD],
          },
        ]);
        await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "PUBLISH_TIME_EXCEEDS_THRESHOLD_TIME",
        );
      });
      it("Should return correct amount in reverse order", async function () {
        const price = BigNumber.from("2500").mul(BigNumber.from("10").pow("18"));
        const oracleData = getEncodedRoutes([
          [
            tokenA.address,
            OracleType.Stork,
            getEncodedStorkOracleData((await provider.getBlock("latest")).timestamp, price, HashZero, HashZero, 0),
          ],
        ]);
        await priceOracle.updateStorkPairIds([
          {
            pair: "TOKENAUSD",
            tokens: [tokenA.address, USD],
          },
        ]);
        const amount = await priceOracle.callStatic.getExchangeRate(USD, tokenA.address, oracleData);
        // price in wad
        expect(amount).to.be.equal(wadDiv(WAD, price.toString()));
      });
      it("Should return correct amount in direct order", async function () {
        const price = BigNumber.from("2500").mul(BigNumber.from("10").pow("18"));
        const oracleData = getEncodedRoutes([
          [USD, OracleType.Stork, getEncodedStorkOracleData((await provider.getBlock("latest")).timestamp, price, HashZero, HashZero, 0)],
        ]);

        await priceOracle.updateStorkPairIds([
          {
            pair: "TOKENAUSD",
            tokens: [tokenA.address, USD],
          },
        ]);
        const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
        // price in wad
        expect(amount).to.be.equal(price);
      });
    });

    describe("getExchangeRate when oracle is Curve LP", function () {
      it("Should revert when there is no a curve oracle for the oracle type", async function () {
        await priceOracle.updateCurveTypeOracle([CurveOracleKind.STABLE], [ZERO_ADDRESS]);
        const oracleData = getEncodedRoutes([[USD, OracleType.CurveLPOracle, getEncodedCurveLTOracleData(CurveOracleKind.STABLE, [[]])]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_PRICEFEED_FOUND",
        );
      });
      it("Should revert when neither token is USD", async function () {
        await priceOracle.updateCurveTypeOracle([CurveOracleKind.STABLE], [ZERO_ADDRESS]);
        const oracleData = getEncodedRoutes([
          [tokenB.address, OracleType.CurveLPOracle, getEncodedCurveLTOracleData(CurveOracleKind.STABLE, [[]])],
        ]);
        await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INCORRECT_CURVELP_ROUTE",
        );
      });
      it("Should return correct price tokenA/USD", async function () {
        // setup UniswapPriceFeed
        await mockCurvePriceFeed.mock.getPrice.returns(WAD);
        await priceOracle.updateCurveTypeOracle([CurveOracleKind.STABLE], [mockCurvePriceFeed.address]);
        const oracleData = getEncodedRoutes([[USD, OracleType.CurveLPOracle, getEncodedCurveLTOracleData(CurveOracleKind.STABLE, [[]])]]);
        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
        expect(amount).to.equal(WAD);
      });
      it("Should return correct price USD/tokenA", async function () {
        const price = BigNumber.from(WAD).div("2");
        // setup UniswapPriceFeed
        await mockCurvePriceFeed.mock.getPrice.returns(price);
        await priceOracle.updateCurveTypeOracle([CurveOracleKind.STABLE], [mockCurvePriceFeed.address]);
        const oracleData = getEncodedRoutes([
          [tokenA.address, OracleType.CurveLPOracle, getEncodedCurveLTOracleData(CurveOracleKind.STABLE, [[]])],
        ]);
        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(USD, tokenA.address, oracleData);
        expect(amount).to.equal(wadDiv(WAD, price));
      });
    });

    describe("getExchangeRate when oracle is UniswapV2 LP Oracle", function () {
      let price;
      before(async function () {
        price = parseEther("1.2");
        await mockUniswapV2LPOracle.mock.getLPExchangeRate.returns(price);
      });
      it("Should revert when passed token is not a uniswap lp", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.UniswapV2LP, getEncodedUniswapV2LPOracleData(["0x", "0x"])]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ADDRESS_IS_NOT_UNISWAPV2LP_TOKEN",
        );
      });
      it("Should revert when neither token is USD", async function () {
        await priceOracle.addUniswapV2LPTokens([tokenA.address]);
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.UniswapV2LP, getEncodedUniswapV2LPOracleData(["0x", "0x"])]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INCORRECT_UNISWAPV2LP_ROUTE",
        );
      });
      it("Should return correct price tokenA/USD", async function () {
        await priceOracle.addUniswapV2LPTokens([tokenA.address]);

        const oracleData = getEncodedRoutes([[USD, OracleType.UniswapV2LP, getEncodedUniswapV2LPOracleData(["0x", "0x"])]]);
        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
        expect(amount).to.equal(price);
      });
      it("Should return correct price USD/tokenA", async function () {
        await priceOracle.addUniswapV2LPTokens([tokenA.address]);

        const oracleData = getEncodedRoutes([[tokenA.address, OracleType.UniswapV2LP, getEncodedUniswapV2LPOracleData(["0x", "0x"])]]);
        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(USD, tokenA.address, oracleData);
        expect(amount).to.equal(wadDiv(WAD, price));
      });
    });

    describe("getExchangeRate when oracle is EIP4626", function () {
      it("Should revert when there is no a curve oracle for the oracle type", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.EIP4626, "0x"]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_UNDERLYING_TOKEN_FOUND",
        );
      });
      it("Should revert when neither token is USD", async function () {
        await priceOracle.updateEIP4626TokenToUnderlyingAsset([tokenA.address], [tokenB.address]);
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.EIP4626, "0x"]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INCORRECT_EIP4626_ROUTE",
        );
      });
      it("Should return correct price EIP4626/USD", async function () {
        const shareExchangePrice = parseUnits("1.2", "18");
        // setup
        await priceOracle.updateEIP4626TokenToUnderlyingAsset([mockEIP4626.address], [mockEIP4626Underlying.address]);
        await mockEIP4626.mock.decimals.returns(18);
        await mockEIP4626.mock.previewRedeem.returns(shareExchangePrice); // 1.2 is the exchange price

        const pythOracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
        await priceOracle.updatePythPairId([mockEIP4626Underlying.address], [NOT_ZERO_BYTES]);
        const price = BigNumber.from("3");
        const expo = -8;
        const expoPrice = price.mul(BigNumber.from("10").pow(expo * -1));
        // price is negative
        await mockPyth.mock.getPrice.returns({
          price: expoPrice,
          conf: 0,
          expo: expo,
          publishTime: (await provider.getBlock("latest")).timestamp,
        });

        const oracleData = getEncodedRoutes([[USD, OracleType.EIP4626, pythOracleData]]);

        // retrieve price and direction
        const eip4626Price = await priceOracle.callStatic.getExchangeRate(mockEIP4626.address, USD, oracleData);
        const underlyingPrice = await priceOracle.callStatic.getExchangeRate(mockEIP4626Underlying.address, USD, pythOracleData);
        const expectedPrice = wadMul(shareExchangePrice, underlyingPrice);
        expect(eip4626Price).to.be.equal(expectedPrice);
      });
      it("Should return correct price EIP4626/USD when the underlying asset has a different decimals", async function () {
        const underlyingDecimals = 6;
        await mockEIP4626Underlying.mock.decimals.returns(underlyingDecimals);
        const shareExchangePrice = parseUnits("1.2", underlyingDecimals);
        // setup
        await priceOracle.updateEIP4626TokenToUnderlyingAsset([mockEIP4626.address], [mockEIP4626Underlying.address]);
        await mockEIP4626.mock.decimals.returns(18);
        await mockEIP4626.mock.previewRedeem.returns(shareExchangePrice); // 1.2 is the exchange price

        const pythOracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
        await priceOracle.updatePythPairId([mockEIP4626Underlying.address], [NOT_ZERO_BYTES]);
        const price = BigNumber.from("3");
        const expo = -8;
        const expoPrice = price.mul(BigNumber.from("10").pow(expo * -1));
        // price is negative
        await mockPyth.mock.getPrice.returns({
          price: expoPrice,
          conf: 0,
          expo: expo,
          publishTime: (await provider.getBlock("latest")).timestamp,
        });

        const oracleData = getEncodedRoutes([[USD, OracleType.EIP4626, pythOracleData]]);

        // retrieve price and direction
        const eip4626Price = await priceOracle.callStatic.getExchangeRate(mockEIP4626.address, USD, oracleData);
        const underlyingPrice = await priceOracle.callStatic.getExchangeRate(mockEIP4626Underlying.address, USD, pythOracleData);
        const expectedPrice = wadMul(shareExchangePrice.mul(BigNumber.from("10").pow(18 - underlyingDecimals)), underlyingPrice);
        expect(eip4626Price).to.be.equal(expectedPrice);
      });
      it("Should return correct price EIP4626/USD when EIP4626Underlying and the one set in updateEIP4626TokenToUnderlyingAsset do not match", async function () {
        const underlyingDecimals = 6;
        await mockEIP4626Underlying.mock.decimals.returns(underlyingDecimals);
        const shareExchangePrice = parseUnits("1.2", underlyingDecimals);
        // setup
        await priceOracle.updateEIP4626TokenToUnderlyingAsset([mockEIP4626.address], [tokenA.address]);
        await mockEIP4626.mock.decimals.returns(18);
        await mockEIP4626.mock.previewRedeem.returns(shareExchangePrice); // 1.2 is the exchange price

        const pythOracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
        await priceOracle.updatePythPairId([tokenA.address], [NOT_ZERO_BYTES]);
        const price = BigNumber.from("3");
        const expo = -8;
        const expoPrice = price.mul(BigNumber.from("10").pow(expo * -1));
        // price is negative
        await mockPyth.mock.getPrice.returns({
          price: expoPrice,
          conf: 0,
          expo: expo,
          publishTime: (await provider.getBlock("latest")).timestamp,
        });

        const oracleData = getEncodedRoutes([[USD, OracleType.EIP4626, pythOracleData]]);

        // retrieve price and direction
        const eip4626Price = await priceOracle.callStatic.getExchangeRate(mockEIP4626.address, USD, oracleData);
        const underlyingPrice = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, pythOracleData);
        const expectedPrice = wadMul(shareExchangePrice.mul(BigNumber.from("10").pow(18 - underlyingDecimals)), underlyingPrice);
        expect(eip4626Price).to.be.equal(expectedPrice);
      });
      it("Should return correct price USD/EIP4626", async function () {
        const shareExchangePrice = parseEther("1.2");
        // setup
        await priceOracle.updateEIP4626TokenToUnderlyingAsset([mockEIP4626.address], [mockEIP4626Underlying.address]);
        await mockEIP4626.mock.decimals.returns(18);
        await mockEIP4626.mock.previewRedeem.returns(shareExchangePrice); // 1.2 is the exchange price

        const pythOracleData = getEncodedRoutes([[USD, OracleType.Pyth, "0x"]]);
        await priceOracle.updatePythPairId([mockEIP4626Underlying.address], [NOT_ZERO_BYTES]);
        const price = BigNumber.from("3");
        const expo = -8;
        const expoPrice = price.mul(BigNumber.from("10").pow(expo * -1));
        // price is negative
        await mockPyth.mock.getPrice.returns({
          price: expoPrice,
          conf: 0,
          expo: expo,
          publishTime: (await provider.getBlock("latest")).timestamp,
        });

        const oracleData = getEncodedRoutes([[mockEIP4626.address, OracleType.EIP4626, pythOracleData]]);

        // retrieve price and direction
        const eip4626Price = await priceOracle.callStatic.getExchangeRate(USD, mockEIP4626.address, oracleData);
        const underlyingPrice = await priceOracle.callStatic.getExchangeRate(mockEIP4626Underlying.address, USD, pythOracleData);
        const expectedPrice = wadDiv(WAD, wadMul(shareExchangePrice, underlyingPrice));
        expect(eip4626Price).to.be.equal(expectedPrice);
      });
    });

    describe("getExchangeRate when oracle is Uniswap", function () {
      it("Should revert when there is no a uni oracle for the oracle type", async function () {
        await priceOracle.updateUniv3TypeOracle([0], [ZERO_ADDRESS]);
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Uniswapv3, "0x"]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_PRICEFEED_FOUND",
        );
      });
      it("Should revert when tokenA/TokenB is not a trusted pair", async function () {
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Uniswapv3, "0x"]]);
        await priceOracle.updateUniv3TypeOracle([0], [mockUniswapPriceFeed.address]);
        await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "TOKEN_PAIR_IS_NOT_TRUSTED",
        );
      });
      it("Should return correct price tokenA/tokenB", async function () {
        // setup UniswapPriceFeed
        await mockUniswapPriceFeed.mock.getExchangeRate.returns(WAD);
        await priceOracle.updateUniv3TypeOracle([0], [mockUniswapPriceFeed.address]);
        await priceOracle.updateUniv3TrustedPair([
          {
            oracleType: 0,
            tokenA: tokenA.address,
            tokenB: tokenB.address,
            isTrusted: true,
          },
        ]);
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Uniswapv3, "0x"]]);

        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, tokenB.address, oracleData);
        expect(amount).to.equal(WAD);
      });
      it("Should return correct price tokenB/tokenA", async function () {
        // setup UniswapPriceFeed
        await mockUniswapPriceFeed.mock.getExchangeRate.returns(WAD);
        await priceOracle.updateUniv3TypeOracle([0], [mockUniswapPriceFeed.address]);
        await priceOracle.updateUniv3TrustedPair([
          {
            oracleType: 0,
            tokenA: tokenA.address,
            tokenB: tokenB.address,
            isTrusted: true,
          },
        ]);
        const oracleRoutes = getEncodedRoutes([[tokenA.address, OracleType.Uniswapv3, "0x"]]);

        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(tokenB.address, tokenA.address, oracleRoutes);
        expect(amount).to.equal(WAD);
      });
    });
    describe("getExchangeRate when oracle is ChainLink", function () {
      it("Should return correct price tokenA/USD", async function () {
        // setup aggregatorInterface
        const aggregatorInterface = await deployMockAggregatorV3Interface(deployer);
        const price = 200;
        await aggregatorInterface.mock.latestRoundData.returns([0], [price], [0], [0], [0]);
        await aggregatorInterface.mock.decimals.returns(0);

        // update price feed
        await priceOracle.updateChainlinkPriceFeedsUsd([tokenA.address], [aggregatorInterface.address]);

        const oracleData = getEncodedRoutes([[USD, OracleType.Chainlink, "0x"]]);

        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData);
        expect(amount).to.equal((price * Math.pow(10, 18)).toString());
      });
      it("Should return correct invert price when tokenA is the USD", async function () {
        // setup aggregatorInterface
        const aggregatorInterface = await deployMockAggregatorV3Interface(deployer);
        const price = 200;
        await aggregatorInterface.mock.latestRoundData.returns([0], [price], [0], [0], [0]);
        await aggregatorInterface.mock.decimals.returns(0);

        // update price feed
        await priceOracle.updateChainlinkPriceFeedsUsd([tokenA.address], [aggregatorInterface.address]);

        const oracleData = getEncodedRoutes([[tokenA.address, OracleType.Chainlink, "0x"]]);

        // retrieve price and direction
        const amount = await priceOracle.callStatic.getExchangeRate(USD, tokenA.address, oracleData);
        expect(amount).to.equal(wadDiv(WAD, (price * Math.pow(10, 18)).toString()));
      });
      it("Should revert if the price from oracle is zero", async function () {
        // setup aggregatorInterface
        const aggregatorInterface = await deployMockAggregatorV3Interface(deployer);
        const price = 0;
        await aggregatorInterface.mock.latestRoundData.returns([0], [price], [0], [0], [0]);
        await aggregatorInterface.mock.decimals.returns(0);

        // update price feed
        await priceOracle.updateChainlinkPriceFeedsUsd([tokenA.address], [aggregatorInterface.address]);

        const oracleData = getEncodedRoutes([[USD, OracleType.Chainlink, "0x"]]);

        // retrieve price and direction
        await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ZERO_EXCHANGE_RATE",
        );
      });
      it("Should revert if there is no price feed for the tokenA", async function () {
        const oracleData = getEncodedRoutes([[USD, OracleType.Chainlink, "0x"]]);

        // retrieve price and direction
        await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, USD, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_PRICEFEED_FOUND",
        );
      });
      it("Should revert if the tokenTo in the Chainlink route is incorrect", async function () {
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Chainlink, "0x"]]);
        // retrieve price and direction
        await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INCORRECT_CHAINLINK_ROUTE",
        );
      });
    });
    describe("getExchangeRate when oracle is Supra", function () {
      it("Should revert when the oracle route is the Supra and there is no a price feed for the tokens", async function () {
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Supra, "0x"]]);
        await expect(priceOracle.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "NO_PRICEFEED_FOUND",
        );
      });
      it("Should revert when the publishTime exceeds the time tolerance ", async function () {
        const oracleData = getEncodedRoutes([[tokenB.address, OracleType.Supra, "0x"]]);
        await priceOracle.updateSupraDataFeed([
          {
            tokenA: tokenA.address,
            tokenB: tokenB.address,
            feedData: {
              id: 0,
              initialize: true,
            },
          },
        ]);
        const price = BigNumber.from("2500");
        // price is negative
        await supraStorageMock.mock.getSvalue.returns({
          round: (await provider.getBlock("latest")).timestamp,
          decimals: 18,
          time: (await provider.getBlock("latest")).timestamp - 70,
          price: price.mul(BigNumber.from("10").pow("18")),
        });
        await expect(priceOracle.callStatic.getExchangeRate(tokenA.address, tokenB.address, oracleData)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "PUBLISH_TIME_EXCEEDS_THRESHOLD_TIME",
        );
      });
    });
  });

  describe("updatePriceDropFeed()", function () {
    it("Should revert if msg.sender is not granted with a role MEDIUM_TIMELOCK_ADMIN", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(false);
      priceOracle = await upgrades.deployProxy(
        priceOracleFactory,
        [mockRegistry.address, NATIVE_CURRENCY, tokenA.address, mockTreasury.address],
        {
          unsafeAllow: ["constructor", "delegatecall"],
        },
      );
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

  describe("updatePriceDropFeeds()", function () {
    it("Should revert if msg.sender is not granted with a role MEDIUM_TIMELOCK_ADMIN", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(false);
      priceOracle = await upgrades.deployProxy(
        priceOracleFactory,
        [mockRegistry.address, NATIVE_CURRENCY, tokenA.address, mockTreasury.address],
        {
          unsafeAllow: ["constructor", "delegatecall"],
        },
      );
      await expect(
        priceOracle.updatePriceDropFeeds([[tokenA.address, tokenB.address, mockPriceDropFeed.address]]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert if token addresses in pair to add are identical", async function () {
      await expect(
        priceOracle.updatePriceDropFeeds([[tokenA.address, tokenA.address, mockPriceDropFeed.address]]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "IDENTICAL_TOKEN_ADDRESSES");
    });

    it("Should add a priceDrop feed if token addresses in pair are different", async function () {
      expect(await priceOracle.updatePriceDropFeeds([[tokenA.address, tokenB.address, mockPriceDropFeed.address]]));
      expect(tokenA.address).not.equal(tokenB.address);
    });

    it("Should emit PriceDropFeedUpdated when update is successful ", async function () {
      await expect(priceOracle.updatePriceDropFeeds([[tokenA.address, tokenB.address, mockPriceDropFeed.address]]))
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
