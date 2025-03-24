// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther },
  },
} = require("hardhat");

const { deployMockAccessControl, deployMockPriceOracle } = require("../utils/waffleMocks");

process.env.TEST = true;
const { USD } = require("../utils/constants.js");

describe("CurveOracles_integration", function () {
  let BluberryCurveStable, BluberryBaseOracle, BluberryCurveTricrypto, BluberryVolatile;
  let StableLpToken, TricryptoLpToken, VolatileLpToken;
  let curveStableOracle, curveTricryptoOracle, curveVolatileOracle;
  let mockPriceOracle, mockRegistry;
  let deployer;
  before(async function () {
    ({ deployer } = await getNamedSigners());
    // In this test we are just comparing our oracle's values with values of the Bluberry contracts.
    // So we have to run this on the ethereum mainnet fork
    if (network.name !== "localhost") this.skip();

    BluberryCurveStable = await getContractAt("IBlueberryProtocolCurveOracle", "0x58660E94E910DB4215B57823Be7F32A11Ac69532");
    BluberryCurveTricrypto = await getContractAt("IBlueberryProtocolCurveOracle", "0x89DCe547640d98491437c7B0D5a4EE2693CbBD0C");
    BluberryVolatile = await getContractAt("IBlueberryProtocolCurveOracle", "0x74cdfa37f1ce8050465891dc0fe902aab60cc4f4");
    BluberryBaseOracle = await getContractAt("IBlueberryProtocolCurveOracle", "0xdfe469ACe05C3d0D4461439e6cF5d0f46F33Ec56");
    StableLpToken = "0x4dece678ceceb27446b35c672dc7d61f30bad69e";
    TricryptoLpToken = "0x7f86bf177dd4f3494b841a37e810a34dd56c829b";
    VolatileLpToken = "0x5271045f7b73c17825a7a7aee6917ee46b0b7520";
    const CurveAddressProvider = "0x0000000022D53366457F9d5E68Ec105046FC4383";

    mockRegistry = await deployMockAccessControl(deployer);
    mockPriceOracle = (await deployMockPriceOracle(deployer))[0];

    const CurveStableOracleFactory = await getContractFactory("CurveStableOracle");
    const CurveTricryptoOracleFactory = await getContractFactory("CurveTricryptoOracle");
    const CurveVolatileOracleFactory = await getContractFactory("CurveVolatileOracle");

    curveStableOracle = await upgrades.deployProxy(
      CurveStableOracleFactory,
      [CurveAddressProvider, mockPriceOracle.address, mockRegistry.address],
      {
        unsafeAllow: ["constructor", "delegatecall"],
      },
    );
    await curveStableOracle.deployed();

    curveTricryptoOracle = await upgrades.deployProxy(
      CurveTricryptoOracleFactory,
      [CurveAddressProvider, mockPriceOracle.address, mockRegistry.address],
      {
        unsafeAllow: ["constructor", "delegatecall"],
      },
    );
    await curveTricryptoOracle.deployed();

    curveVolatileOracle = await upgrades.deployProxy(
      CurveVolatileOracleFactory,
      [CurveAddressProvider, mockPriceOracle.address, mockRegistry.address],
      {
        unsafeAllow: ["constructor", "delegatecall"],
      },
    );
    await curveVolatileOracle.deployed();
  });

  it("СurveStableOracle", async function () {
    // get token info
    const tokenInfo = await BluberryCurveStable.getTokenInfo(StableLpToken);
    const token0 = tokenInfo.tokens[0];
    const token1 = tokenInfo.tokens[1];
    const token0Price = await BluberryBaseOracle.getPrice(token0);
    const token1Price = await BluberryBaseOracle.getPrice(token1);
    // get the reference price
    const priceFromBluberry = await BluberryCurveStable.getPrice(StableLpToken);

    // mock prices
    await mockPriceOracle.mock.getExchangeRate.withArgs(token0, USD, []).returns(token0Price);
    await mockPriceOracle.mock.getExchangeRate.withArgs(token1, USD, []).returns(token1Price);

    // set up our oracle
    await curveStableOracle.registerCurveLp(StableLpToken, "0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC", 7, [token0, token1]);

    // get our price
    const priceFromOracle = await curveStableOracle.callStatic.getPrice(StableLpToken, [[], []]);

    // check
    expect(priceFromBluberry).to.be.equal(priceFromOracle);
  });

  it("Resgiter sDAI/sUSDe and get price", async function () {
    const stableSwapFactoryNGHandler = "0xe06eba9cea16cc71d4498cdba7240bb20d475890";
    const lpToken = "0x167478921b907422f8e88b43c4af2b8bea278d3a";
    const token0 = "0x83f20f44975d03b1b09e64809b757c47f942beea"; // sDai
    const token1 = "0x9d39a5de30e57443bff2a8307a4256c8797a3497"; // sUSDe

    // mock prices
    await mockPriceOracle.mock.getExchangeRate.withArgs(token0, USD, []).returns(parseEther("1"));
    await mockPriceOracle.mock.getExchangeRate.withArgs(token1, USD, []).returns(parseEther("1"));

    await curveStableOracle.registerCurveLp(lpToken, stableSwapFactoryNGHandler, 7, [token0, token1]);

    // get our price
    const priceFromOracle = await curveStableOracle.callStatic.getPrice(lpToken, [[], []]);

    // check
    expect(priceFromOracle).to.be.greaterThan(parseEther("1"));
  });

  it("СurveTricryptoOracle", async function () {
    // get token info
    const tokenInfo = await BluberryCurveTricrypto.getTokenInfo(TricryptoLpToken);
    const token0 = tokenInfo.tokens[0];
    const token1 = tokenInfo.tokens[1];
    const token2 = tokenInfo.tokens[2];
    const token0Price = await BluberryBaseOracle.getPrice(token0);
    const token1Price = await BluberryBaseOracle.getPrice(token1);
    const token2Price = await BluberryBaseOracle.getPrice(token2);

    // get the reference price
    const priceFromBluberry = await BluberryCurveTricrypto.getPrice(TricryptoLpToken);

    // mock prices
    await mockPriceOracle.mock.getExchangeRate.withArgs(token0, USD, []).returns(token0Price);
    await mockPriceOracle.mock.getExchangeRate.withArgs(token1, USD, []).returns(token1Price);
    await mockPriceOracle.mock.getExchangeRate.withArgs(token2, USD, []).returns(token2Price);

    // set up our oracle
    await curveTricryptoOracle.registerCurveLp(TricryptoLpToken, "0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC", 7, [token0, token1, token2]);

    // get our price
    const priceFromOracle = await curveTricryptoOracle.callStatic.getPrice(TricryptoLpToken, [[], [], []]);

    // check
    expect(priceFromBluberry).to.be.equal(priceFromOracle);
  });
  it("СurveVolatileOracle", async function () {
    // get token info
    const tokenLowerBound = "1003226248525608328";
    const tokenInfo = await BluberryVolatile.getTokenInfo(VolatileLpToken);
    const token0 = tokenInfo.tokens[0];
    const token1 = tokenInfo.tokens[1];
    const token0Price = await BluberryBaseOracle.getPrice(token0);
    const token1Price = await BluberryBaseOracle.getPrice(token1);

    // get the reference price
    const priceFromBluberry = await BluberryVolatile.getPrice(VolatileLpToken);

    // mock prices
    await mockPriceOracle.mock.getExchangeRate.withArgs(token0, USD, []).returns(token0Price);
    await mockPriceOracle.mock.getExchangeRate.withArgs(token1, USD, []).returns(token1Price);

    // set up our oracle
    await curveVolatileOracle.registerCurveLp(VolatileLpToken, "0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC", 7, [token0, token1]);
    await curveVolatileOracle.setLimiter(VolatileLpToken, tokenLowerBound);

    // get our price
    const priceFromOracle = await curveVolatileOracle.callStatic.getPrice(VolatileLpToken, [[], []]);
    // check
    expect(priceFromBluberry).to.be.equal(priceFromOracle);
  });
});
