// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: { getNamedSigners, BigNumber, getContract, getContractFactory },
  deployments: { fixture },
} = require("hardhat");
const { parseEther } = require("ethers/lib/utils");
const { deployMockAccessControl, deployMockPMXToken, deployPrimexNft } = require("../utils/waffleMocks");
const { SMALL_TIMELOCK_ADMIN, TRADER_MAGIC_TIER, LENDER_MAGIC_TIER, FARMING_MAGIC_TIER } = require("../../Constants");
const { parseArguments } = require("../utils/eventValidation");
process.env.TEST = true;

describe("TiersManager_unit", function () {
  let tiersManager;
  let tiersManagerFactory;
  let mockEPMX, mockRegistry;
  let deployer;
  let snapshotId;
  let ErrorsLibrary;
  let tiers;
  let thresholds;
  let mockLendingNft, mockTradingNft, mockFarmingNft;

  before(async function () {
    console.log(TRADER_MAGIC_TIER);
    console.log(LENDER_MAGIC_TIER);
    console.log(FARMING_MAGIC_TIER);
    await fixture(["Errors"]);
    ErrorsLibrary = await getContract("Errors");
    ({ deployer } = await getNamedSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    mockEPMX = await deployMockPMXToken(deployer);
    mockLendingNft = await deployPrimexNft(deployer);
    mockTradingNft = await deployPrimexNft(deployer);
    mockFarmingNft = await deployPrimexNft(deployer);

    tiers = [1, 2, 3];
    thresholds = [parseEther("1"), parseEther("2"), parseEther("3")];

    tiersManagerFactory = await getContractFactory("TiersManager");
    tiersManager = await upgrades.deployProxy(
      tiersManagerFactory,
      [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
      {
        unsafeAllow: ["constructor", "delegatecall"],
      },
    );
    await tiersManager.deployed();
  });

  describe("initialize", function () {
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
    it("Should revert initialize when the EPMX is not supported", async function () {
      await mockEPMX.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          tiersManagerFactory,
          [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the Registry is not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          tiersManagerFactory,
          [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the Lending NFT is not supported", async function () {
      await mockLendingNft.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          tiersManagerFactory,
          [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the Trading NFT is not supported", async function () {
      await mockTradingNft.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          tiersManagerFactory,
          [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the Farming NFT is not supported", async function () {
      await mockFarmingNft.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          tiersManagerFactory,
          [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should successful initialize", async function () {
      expect(
        await upgrades.deployProxy(
          tiersManagerFactory,
          [mockEPMX.address, mockRegistry.address, mockLendingNft.address, mockTradingNft.address, mockFarmingNft.address, [], []],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      );
    });
  });

  describe("addTiers", function () {
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
    it("Should revert if not SMALL_TIMELOCK_ADMIN call addTiers", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, deployer.address).returns(false);
      await expect(tiersManager.addTiers(tiers, thresholds, false)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert when param's length mismatch", async function () {
      await expect(tiersManager.addTiers(tiers.slice(0, 1), thresholds, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });
    it("Should revert when passed tier is zero (default tier)", async function () {
      await expect(tiersManager.addTiers([0], [thresholds[0]], false)).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_TIER");
    });
    it("Should revert when passed tiers aren't sorted", async function () {
      await expect(tiersManager.addTiers([2, 1, 3], thresholds, false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_TIERS_ORDER",
      );
    });
    it("Should revert when the last added tier is less or equal to the first passed one", async function () {
      // add tier
      await tiersManager.addTiers([tiers[0]], [thresholds[0]], false);
      // try to pass the same tier
      await expect(tiersManager.addTiers([tiers[0]], [thresholds[0]], false)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_TIERS_ORDER",
      );
    });

    it("Should added tiers", async function () {
      await tiersManager.addTiers(tiers, thresholds, false);
      const settedTiers = await tiersManager.getTiers();

      expect(settedTiers[0]).to.be.equal(tiers[0]);
      expect(settedTiers[1]).to.be.equal(tiers[1]);
      expect(settedTiers[2]).to.be.equal(tiers[2]);
      expect(await tiersManager.tiersThresholds(tiers[0])).to.be.equal(thresholds[0]);
      expect(await tiersManager.tiersThresholds(tiers[1])).to.be.equal(thresholds[1]);
      expect(await tiersManager.tiersThresholds(tiers[2])).to.be.equal(thresholds[2]);
    });
  });

  describe("getTraderTierForAddress", function () {
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
    before(async function () {
      await tiersManager.addTiers(tiers, thresholds, false);
    });
    it("Should correct return default tier", async function () {
      await mockEPMX.mock.balanceOf.returns(0);
      expect(await tiersManager.getTraderTierForAddress(deployer.address)).to.be.equal(0);
    });

    it("Should correct return first tier", async function () {
      await mockEPMX.mock.balanceOf.returns(parseEther("1"));
      expect(await tiersManager.getTraderTierForAddress(deployer.address)).to.be.equal(tiers[0]);
    });
    it("Should correct return the last tier", async function () {
      await mockEPMX.mock.balanceOf.returns(parseEther("3"));
      expect(await tiersManager.getTraderTierForAddress(deployer.address)).to.be.equal(tiers[2]);
    });
    it("Should correct return the magic tier when the user has an active trading nft", async function () {
      await mockTradingNft.mock.hasUserActiveToken.returns(true);
      await mockEPMX.mock.balanceOf.returns(parseEther("3"));
      expect(await tiersManager.getTraderTierForAddress(deployer.address)).to.be.equal(BigNumber.from(TRADER_MAGIC_TIER));
    });
    it("Should correct return the magic tier when the user has an active farming nft", async function () {
      await mockFarmingNft.mock.hasUserActiveToken.returns(true);
      await mockEPMX.mock.balanceOf.returns(parseEther("3"));
      expect(await tiersManager.getTraderTierForAddress(deployer.address)).to.be.equal(BigNumber.from(FARMING_MAGIC_TIER));
    });
  });

  describe("getTraderTiersForAddresses", function () {
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
    before(async function () {
      await mockTradingNft.mock.haveUsersActiveTokens.returns([false]);
      await mockFarmingNft.mock.haveUsersActiveTokens.returns([false]);
    });
    it("Should correct return default tier", async function () {
      await mockEPMX.mock.balanceOf.returns(0);
      parseArguments(await tiersManager.getTraderTiersForAddresses([deployer.address]), [0]);
    });

    it("Should correct return first tier", async function () {
      await mockEPMX.mock.balanceOf.returns(parseEther("1"));
      parseArguments(await tiersManager.getTraderTiersForAddresses([deployer.address]), [tiers[0]]);

      await mockEPMX.mock.balanceOf.returns(parseEther("1.5"));
      parseArguments(await tiersManager.getTraderTiersForAddresses([deployer.address]), [tiers[0]]);
    });
    it("Should correct return the last tier", async function () {
      await mockEPMX.mock.balanceOf.returns(parseEther("3"));
      parseArguments(await tiersManager.getTraderTiersForAddresses([deployer.address]), [tiers[2]]);
    });

    it("Should correct return the magic tier when the user has an active trading nft", async function () {
      await mockTradingNft.mock.haveUsersActiveTokens.returns([true]);
      await mockEPMX.mock.balanceOf.returns(parseEther("3"));
      parseArguments(await tiersManager.getTraderTiersForAddresses([deployer.address]), [BigNumber.from(TRADER_MAGIC_TIER)]);
    });
    it("Should correct return the magic tier when the user has an active farming nft", async function () {
      await mockFarmingNft.mock.haveUsersActiveTokens.returns([true]);
      await mockEPMX.mock.balanceOf.returns(parseEther("3"));
      parseArguments(await tiersManager.getTraderTiersForAddresses([deployer.address]), [BigNumber.from(FARMING_MAGIC_TIER)]);
    });
  });

  describe("changeThresholdForTier", function () {
    before(async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, deployer.address).returns(true);
      await tiersManager.addTiers(tiers, thresholds, true);
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
    it("Should revert if not SMALL_TIMELOCK_ADMIN call changeThresholdForTier", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, deployer.address).returns(false);
      await expect(tiersManager.changeThresholdForTier([0], [parseEther("2")])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert when param's length mismatch", async function () {
      await expect(tiersManager.changeThresholdForTier([0], [])).to.be.revertedWithCustomError(ErrorsLibrary, "PARAMS_LENGTH_MISMATCH");
    });
    it("Should changeThresholdForTier", async function () {
      const tierIndex = 0;
      const tier = 1;
      await tiersManager.changeThresholdForTier([tierIndex], [parseEther("1.5")]);
      expect(await tiersManager.tiersThresholds(tier)).to.be.equal(parseEther("1.5"));
    });
  });
});
