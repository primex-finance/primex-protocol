// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
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

  describe("constructor", function () {
    let snapshotId, SwapManagerFactory, args;
    before(async function () {
      SwapManagerFactory = await getContractFactory("SwapManager", {
        libraries: {
          TokenTransfersLibrary: tokenTransfersLibrary.address,
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
    });

    beforeEach(async function () {
      args = [registry.address, primexDNS.address, traderBalanceVault.address, priceOracle.address, mockWhiteBlackList.address];
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
      expect(await SwapManagerFactory.deploy(...args));
    });

    it("Should revert deploy when registry address not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      args[0] = mockRegistry.address;
      await expect(SwapManagerFactory.deploy(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when dns address not supported", async function () {
      await mockPrimexDns.mock.supportsInterface.returns(false);
      args[1] = mockPrimexDns.address;
      await expect(SwapManagerFactory.deploy(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when traderBalanceVault address not supported", async function () {
      await mockTraderBalanceVault.mock.supportsInterface.returns(false);
      args[2] = mockTraderBalanceVault.address;
      await expect(SwapManagerFactory.deploy(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when priceOracle address not supported", async function () {
      await mockPriceOracle.mock.supportsInterface.returns(false);
      args[3] = mockPriceOracle.address;
      await expect(SwapManagerFactory.deploy(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy when WhiteBlackList address not supported", async function () {
      await mockWhiteBlackList.mock.supportsInterface.returns(false);
      args[3] = mockPriceOracle.address;
      await expect(SwapManagerFactory.deploy(...args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
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
