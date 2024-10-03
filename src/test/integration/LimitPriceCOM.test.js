// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  network,
  ethers: {
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");

const { setupUsdOraclesForToken, setupUsdOraclesForTokens } = require("../utils/oracleUtils");

const { addLiquidity } = require("../utils/dexOperations");

const { NATIVE_CURRENCY, USD_DECIMALS } = require("../utils/constants");

process.env.TEST = true;

describe("LimitPriceCOM_integration", function () {
  let snapshotId;
  let trader;
  let primexDNS,
    priceOracle,
    positionManager,
    limitPriceCOM,
    primexPricingLibrary,
    primexPricingLibraryMock,
    traderBalanceVault,
    keeperRewardDistributor,
    registry,
    testTokenA,
    testTokenB,
    ErrorsLibrary,
    decimalsA;
  let dex;

  before(async function () {
    await fixture(["Test"]);
    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }

    ({ trader } = await getNamedSigners());
    limitPriceCOM = await getContract("LimitPriceCOM");
    primexDNS = await getContract("PrimexDNS");
    priceOracle = await getContract("PriceOracle");
    positionManager = await getContract("PositionManager");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    keeperRewardDistributor = await getContract("KeeperRewardDistributor");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibraryMock.deployed();
    registry = await getContract("Registry");
    traderBalanceVault = await getContract("TraderBalanceVault");
    ErrorsLibrary = await getContract("Errors");

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");

    const ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: parseEther("1") });

    await addLiquidity({
      dex: dex,
      from: "lender",
      tokenA: testTokenA,
      tokenB: testTokenB,
      amountADesired: "10000",
      amountBDesired: "10000",
    });
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

  describe("constructor", function () {
    let LimitPriceCOMFactory;

    before(async function () {
      LimitPriceCOMFactory = await getContractFactory("LimitPriceCOM");
    });
    it("Should initialize with correct values", async function () {
      expect(await limitPriceCOM.primexDNS()).to.equal(primexDNS.address);
      expect(await limitPriceCOM.priceOracle()).to.equal(priceOracle.address);
      expect(await limitPriceCOM.pm()).to.equal(positionManager.address);
    });

    it("Should revert when initialized with wrong primexDNS address", async function () {
      const wrongAddress = registry.address;
      const LimitPriceCOM = await LimitPriceCOMFactory.deploy(registry.address);
      await expect(
        LimitPriceCOM.initialize(wrongAddress, priceOracle.address, positionManager.address, keeperRewardDistributor.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong priceOracle address", async function () {
      const wrongAddress = registry.address;
      const LimitPriceCOM = await LimitPriceCOMFactory.deploy(registry.address);
      await expect(
        LimitPriceCOM.initialize(primexDNS.address, wrongAddress, positionManager.address, keeperRewardDistributor.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong positionManager address", async function () {
      const wrongAddress = registry.address;
      const LimitPriceCOM = await LimitPriceCOMFactory.deploy(registry.address);
      await expect(
        LimitPriceCOM.initialize(primexDNS.address, priceOracle.address, wrongAddress, keeperRewardDistributor.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when initialized with wrong keeperRewardDistributor address", async function () {
      const wrongAddress = registry.address;
      const LimitPriceCOM = await LimitPriceCOMFactory.deploy(registry.address);
      await expect(
        LimitPriceCOM.initialize(primexDNS.address, priceOracle.address, positionManager.address, wrongAddress),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });
});
