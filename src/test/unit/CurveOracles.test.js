// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  upgrades,
  ethers: {
    getSigners,
    getContract,
    getContractFactory,
    utils: { parseEther },
  },
  deployments: { fixture },
} = require("hardhat");
const {
  deployMockAccessControl,
  deployMockERC20,
  deployMockPriceOracle,
  deployMockCurveAddressProvider,
  deployMockCurveRegistry,
  deployMockCurvePool,
} = require("../utils/waffleMocks");

const { WAD, USD } = require("../utils/constants.js");
const { SMALL_TIMELOCK_ADMIN } = require("../../Constants");

const { wadMul } = require("../utils/bnMath.js");

process.env.TEST = true;

describe("CurveOracles_unit", function () {
  let CurveStableOracleFactory;
  let curveStableOracle, curveTricryptoOracle;
  let mockRegistry, mockPriceOracle, mockCurveAddressProvider, mockCurveRegistry, mockPool;
  let tokenA, tokenB, lpToken;
  let deployer, caller;
  let ErrorsLibrary;
  before(async function () {
    await fixture(["Errors"]);
    [deployer, caller] = await getSigners();

    mockRegistry = await deployMockAccessControl(deployer);
    ErrorsLibrary = await getContract("Errors");
    mockPriceOracle = (await deployMockPriceOracle(deployer))[0];
    mockCurveAddressProvider = await deployMockCurveAddressProvider(deployer);
    mockCurveRegistry = await deployMockCurveRegistry(deployer);
    tokenA = await deployMockERC20(deployer);
    tokenB = await deployMockERC20(deployer);
    lpToken = await deployMockERC20(deployer);
    mockPool = await deployMockCurvePool(deployer);

    await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, caller.address).returns(false);

    await mockCurveAddressProvider.mock.get_registry.returns(mockCurveRegistry.address);
    await mockPriceOracle.mock.getExchangeRate.returns(WAD);

    // registry is like mock pool
    await mockCurveRegistry.mock.get_pool_from_lp_token.withArgs(lpToken.address).returns(mockPool.address);

    await mockCurveRegistry.mock.get_n_coins.withArgs(mockPool.address).returns(2, 0);
    await mockCurveRegistry.mock.get_virtual_price_from_lp_token.returns(WAD);
    CurveStableOracleFactory = await getContractFactory("CurveStableOracle");

    curveStableOracle = await upgrades.deployProxy(
      CurveStableOracleFactory,
      [mockCurveAddressProvider.address, mockPriceOracle.address, mockRegistry.address],
      {
        unsafeAllow: ["constructor", "delegatecall"],
      },
    );
    await curveStableOracle.deployed();

    const CurveTricryptoOracleFactory = await getContractFactory("CurveTricryptoOracle");

    curveTricryptoOracle = await upgrades.deployProxy(
      CurveTricryptoOracleFactory,
      [mockCurveAddressProvider.address, mockPriceOracle.address, mockRegistry.address],
      {
        unsafeAllow: ["constructor", "delegatecall"],
      },
    );
    await curveTricryptoOracle.deployed();

    await curveStableOracle.registerCurveLp(lpToken.address, mockCurveRegistry.address, 0, [tokenA.address, tokenB.address]);
    await curveTricryptoOracle.registerCurveLp(lpToken.address, mockCurveRegistry.address, 0, [tokenA.address, tokenB.address]);
  });

  describe("CurveStableOracle", function () {
    it("Should revert if not SMALL_TIMELOCK_ADMIN call registerCurveLp", async function () {
      await expect(
        curveStableOracle.connect(caller).registerCurveLp(lpToken.address, mockCurveRegistry.address, 0, [tokenA.address, tokenB.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if the number of tokens doesn't match", async function () {
      await expect(
        curveStableOracle.registerCurveLp(lpToken.address, mockCurveRegistry.address, 0, [tokenA.address, tokenB.address, tokenA.address]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_TOKENS_LENGTH");
    });
    it("Should revert when initialized with wrong addresses", async function () {
      // test Registry
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(CurveStableOracleFactory, [mockCurveAddressProvider.address, mockPriceOracle.address, mockRegistry.address], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      await mockRegistry.mock.supportsInterface.returns(true);
    });
    describe("CurveStableOracle", function () {
      it("Should revert when when oracle data and number of coins mismatch", async function () {
        await expect(curveStableOracle.callStatic.getPrice(lpToken.address, [[]])).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ORACLE_DATA_AND_TOKENS_LENGTH_MISMATCH",
        );
      });

      it("Should return correct price of LP token", async function () {
        const testTokenAPrice = parseEther("1.5");
        const testTokenBPrice = parseEther("1.2");
        const virtualPrice = parseEther("1.1");
        await mockPriceOracle.mock.getExchangeRate.withArgs(tokenA.address, USD, []).returns(testTokenAPrice);
        await mockPriceOracle.mock.getExchangeRate.withArgs(tokenB.address, USD, []).returns(testTokenBPrice);
        await mockCurveRegistry.mock.get_virtual_price_from_lp_token.returns(virtualPrice);
        expect(await curveStableOracle.callStatic.getPrice(lpToken.address, [[], []])).to.be.equal(wadMul(testTokenBPrice, virtualPrice));
      });
    });
    describe("CurveTricryptoOracle", function () {
      it("Should revert when when oracle data is incorrect", async function () {
        await expect(curveTricryptoOracle.callStatic.getPrice(lpToken.address, [[]])).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INCORRECT_ORACLE_DATA",
        );
      });
    });
  });
});
