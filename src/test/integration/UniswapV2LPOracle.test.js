// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  network,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther },
  },
  deployments: { fixture },
} = require("hardhat");

const { setupUsdOraclesForTokens, getEncodedChainlinkRouteToUsd } = require("../utils/oracleUtils");

const { addLiquidity } = require("../utils/dexOperations");
const { wadMul, wadDiv } = require("../utils/bnMath");

const { deployUniswapPairMock, deployMockPriceOracle } = require("../utils/waffleMocks");

const { USD_MULTIPLIER, USD } = require("../utils/constants");

process.env.TEST = true;

describe("UniswapV2LPOracle_integration", function () {
  let snapshotId;
  let primexDNS;
  let UniswapV2LPOracle;
  let testTokenA, testTokenB;
  let dex, router, factory, pair;
  let deployer;
  let priceOracle, ttAOracleData, ttBOracleData;
  let token0, token1;
  let mockUniswapPair, mockPriceOracle;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    dex = "uniswap";
    ({ deployer } = await getNamedSigners());

    testTokenA = await getContract("TestTokenA");
    testTokenB = await getContract("TestTokenB");

    priceOracle = await getContract("PriceOracle");
    UniswapV2LPOracle = await getContract("UniswapV2LPOracle");
    ErrorsLibrary = await getContract("Errors");

    ttAOracleData = getEncodedChainlinkRouteToUsd();
    ttBOracleData = getEncodedChainlinkRouteToUsd();

    primexDNS = await getContract("PrimexDNS");
    router = (await primexDNS.dexes(dex)).routerAddress;
    // add liquidity to uniswap
    await addLiquidity({
      dex: dex,
      from: "deployer",
      amountADesired: "5",
      amountBDesired: "10",
      tokenA: testTokenA,
      tokenB: testTokenB,
    });

    router = await getContractAt("IUniswapV2Router02", router);
    factory = await router.factory();
    factory = await getContractAt("IUniswapV2Factory", factory);
    pair = await factory.getPair(testTokenA.address, testTokenB.address);
    pair = await getContractAt("UniswapV2Pair", pair);
    mockUniswapPair = await deployUniswapPairMock(deployer);
    mockPriceOracle = (await deployMockPriceOracle(deployer))[0];

    if ((await pair.token0()) === testTokenA.address) {
      token0 = testTokenA;
      token1 = testTokenB;
    } else {
      token0 = testTokenB;
      token1 = testTokenA;
    }

    await mockUniswapPair.mock.token0.returns(token0.address);
    await mockUniswapPair.mock.token1.returns(token1.address);
    await mockUniswapPair.mock.sync.returns();
  });
  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });
  it("should revert when the reserve0 or the reserve1 is zero", async function () {
    const currentReserves = await pair.getReserves();
    await mockUniswapPair.mock.getReserves.returns(0, currentReserves._reserve1, 0);

    await expect(
      UniswapV2LPOracle.callStatic.getQuoteInUsd(mockUniswapPair.address, parseEther("1"), ttAOracleData, ttBOracleData),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_RESERVES");

    await mockUniswapPair.mock.getReserves.returns(currentReserves._reserve0, 0, 0);
    await expect(
      UniswapV2LPOracle.callStatic.getQuoteInUsd(mockUniswapPair.address, parseEther("1"), ttAOracleData, ttBOracleData),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_RESERVES");
  });

  it("should revert when the price0 or the price1 is zero", async function () {
    const UniswapV2LPOracleFactory = await getContractFactory("UniswapV2LPOracle");
    const newUniswapV2LPOracle = await UniswapV2LPOracleFactory.deploy(mockPriceOracle.address);
    await newUniswapV2LPOracle.deployed();

    await mockPriceOracle.mock.getExchangeRate.withArgs(token0.address, USD, ttAOracleData).returns(0);
    await expect(
      newUniswapV2LPOracle.callStatic.getQuoteInUsd(pair.address, parseEther("1"), ttAOracleData, ttBOracleData),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_PRICES");

    await mockPriceOracle.mock.getExchangeRate.withArgs(token0.address, USD, ttAOracleData).returns(parseEther("1").toString());

    await mockPriceOracle.mock.getExchangeRate.withArgs(token1.address, USD, ttAOracleData).returns(0);

    await expect(
      newUniswapV2LPOracle.callStatic.getQuoteInUsd(pair.address, parseEther("1"), ttAOracleData, ttBOracleData),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_PRICES");
  });
  it("should correct return current lp token's price", async function () {
    const currentReserves = await pair.getReserves();
    const lpSupply = await pair.totalSupply();
    const currentPrice = wadDiv(currentReserves._reserve1, currentReserves._reserve0);

    await setupUsdOraclesForTokens(token0, token1, currentPrice.div(USD_MULTIPLIER));

    const tt0USDPrice = await priceOracle.callStatic.getExchangeRate(token0.address, USD, ttAOracleData);

    const tt1USDPrice = await priceOracle.callStatic.getExchangeRate(token1.address, USD, ttBOracleData);

    // (p_0 * r_0 + p_1 * r_1) / LP_supply
    const value0 = wadMul(tt0USDPrice, currentReserves._reserve0);
    const value1 = wadMul(tt1USDPrice, currentReserves._reserve1);
    const lpPrice = wadDiv(value0.add(value1), lpSupply);

    const lpPriceFromOracle = await UniswapV2LPOracle.callStatic.getQuoteInUsd(pair.address, parseEther("1"), ttAOracleData, ttBOracleData);
    // because rounding issue
    expect(lpPriceFromOracle.div(USD_MULTIPLIER)).to.be.equal(lpPrice.div(USD_MULTIPLIER));
  });

  it("should correct return current lp token's price when the reserves change", async function () {
    const currentReserves = await pair.getReserves();
    const lpSupply = await pair.totalSupply();
    const currentPrice = wadDiv(currentReserves._reserve1, currentReserves._reserve0);
    await setupUsdOraclesForTokens(token0, token1, currentPrice.div(USD_MULTIPLIER));

    // k = rY * rX
    const currentK = wadMul(currentReserves._reserve0, currentReserves._reserve1);
    // set actual reserves
    await mockUniswapPair.mock.getReserves.returns(currentReserves._reserve0, currentReserves._reserve1, 0);

    await mockUniswapPair.mock.totalSupply.returns(lpSupply);

    const addedToXReserves = parseEther("2");
    // (x + x1)(y - y1) = k
    const newXReserves = currentReserves._reserve0.add(addedToXReserves);
    // y1 = x1y / x + x1
    const removedFromYReserves = wadDiv(wadMul(addedToXReserves, currentReserves._reserve1), newXReserves);

    const newYReserves = currentReserves._reserve1.sub(removedFromYReserves);
    // approximately becauese of rounding
    expect(wadMul(newXReserves, newYReserves)).to.be.approximately(currentK, "2");

    const lpPriceBeforeMockReserves = await UniswapV2LPOracle.callStatic.getQuoteInUsd(
      mockUniswapPair.address,
      parseEther("1"),
      ttAOracleData,
      ttBOracleData,
    );

    // set new reserves but the same k
    await mockUniswapPair.mock.getReserves.returns(newXReserves, newYReserves, 0);
    const lpPriceAfterMockReserves = await UniswapV2LPOracle.callStatic.getQuoteInUsd(
      mockUniswapPair.address,
      parseEther("1"),
      ttAOracleData,
      ttBOracleData,
    );
    expect(lpPriceBeforeMockReserves).to.be.equal(lpPriceAfterMockReserves);
  });
});
