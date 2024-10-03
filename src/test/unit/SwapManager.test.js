// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: { getContract, getContractFactory, getNamedSigners },
  deployments: { fixture },
} = require("hardhat");

const {
  deployMockAccessControl,
  deployMockPrimexDNS,
  deployMockTraderBalanceVault,
  deployMockPriceOracle,
  deployMockWhiteBlackList,
} = require("../utils/waffleMocks");

process.env.TEST = true;

describe("SwapManager_unit", function () {
  let swapManager, traderBalanceVault, primexDNS, registry, primexPricingLibrary, tokenTransfersLibrary;
  let priceOracle;
  let deployer, caller;
  let mockRegistry, mockPrimexDns, mockTraderBalanceVault, mockPriceOracle, mockWhiteBlackList;

  let ErrorsLibrary;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, caller } = await getNamedSigners());
    swapManager = await getContract("SwapManager");
    primexDNS = await getContract("PrimexDNS");
    registry = await getContract("Registry");
    traderBalanceVault = await getContract("TraderBalanceVault");
    priceOracle = await getContract("PriceOracle");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    ErrorsLibrary = await getContract("Errors");

    mockRegistry = await deployMockAccessControl(deployer);
    mockPrimexDns = await deployMockPrimexDNS(deployer);
    mockTraderBalanceVault = await deployMockTraderBalanceVault(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    [mockPriceOracle] = await deployMockPriceOracle(deployer);
  });

  describe("initialize", function () {
    let snapshotId, SwapManagerFactory, args, deploySM;
    before(async function () {
      SwapManagerFactory = await getContractFactory("SwapManager", {
        libraries: {
          TokenTransfersLibrary: tokenTransfersLibrary.address,
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      deploySM = async function deploySM(args) {
        return await upgrades.deployProxy(SwapManagerFactory, [...args], {
          unsafeAllow: ["constructor", "delegatecall", "external-library-linking"],
        });
      };

      // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
      await upgrades.silenceWarnings();
    });

    beforeEach(async function () {
      args = [registry.address];
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

    it("Should deploy", async function () {
      const swapManager = await deploySM(args);
      expect(await swapManager.registry()).to.be.equal(registry.address);
    });

    it("Should revert deploy when registry address not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      args[0] = mockRegistry.address;
      await expect(deploySM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("initializeAfterUpgrade", function () {
    let snapshotId, SwapManagerFactory, args, deploySM, swapManager;
    before(async function () {
      SwapManagerFactory = await getContractFactory("SwapManager", {
        libraries: {
          TokenTransfersLibrary: tokenTransfersLibrary.address,
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      deploySM = async function deploySM(args) {
        return await upgrades.deployProxy(SwapManagerFactory, [...args], {
          unsafeAllow: ["constructor", "delegatecall", "external-library-linking"],
        });
      };
      swapManager = await deploySM([registry.address]);
    });
    beforeEach(async function () {
      args = [primexDNS.address, traderBalanceVault.address, priceOracle.address, mockWhiteBlackList.address];
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
    it("Should revert if not BIG_TIMELOCK_ADMIN call initializeAfterkUpgrade", async function () {
      await expect(swapManager.connect(caller).initializeAfterUpgrade(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should revert when dns address not supported", async function () {
      await mockPrimexDns.mock.supportsInterface.returns(false);
      args[0] = mockPrimexDns.address;
      await expect(swapManager.initializeAfterUpgrade(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when traderBalanceVault address not supported", async function () {
      await mockTraderBalanceVault.mock.supportsInterface.returns(false);
      args[1] = mockTraderBalanceVault.address;
      await expect(swapManager.initializeAfterUpgrade(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when priceOracle address not supported", async function () {
      await mockPriceOracle.mock.supportsInterface.returns(false);
      args[2] = mockPriceOracle.address;
      await expect(swapManager.initializeAfterUpgrade(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when WhiteBlackList address not supported", async function () {
      await mockWhiteBlackList.mock.supportsInterface.returns(false);
      args[3] = mockWhiteBlackList.address;
      await expect(swapManager.initializeAfterUpgrade(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should initializeAfterUpgrade", async function () {
      await swapManager.initializeAfterUpgrade(...args);
      expect(await swapManager.primexDNS()).to.be.equal(primexDNS.address);
      expect(await swapManager.traderBalanceVault()).to.be.equal(traderBalanceVault.address);
      expect(await swapManager.priceOracle()).to.be.equal(priceOracle.address);
      expect(await swapManager.whiteBlackList()).to.be.equal(mockWhiteBlackList.address);
    });
  });

  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(swapManager.connect(caller).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(swapManager.connect(caller).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
