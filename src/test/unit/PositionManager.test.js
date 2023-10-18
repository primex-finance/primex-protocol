// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getSigners,
    getContract,
    constants: { AddressZero },
    utils: { parseEther },
  },
  deployments: { fixture },
} = require("hardhat");

const { deployMockSpotTradingRewardDistributor, deployMockKeeperRewardDistributor } = require("../utils/waffleMocks");
const { getAdminSigners } = require("../utils/hardhatUtils");

process.env.TEST = true;

describe("PositionManager_unit", function () {
  let positionManager, errorsLibrary, snapshotId;
  let deployer, user2;
  let mockSpotTradingRewardDistributor;
  let mockKeeperRewardDistributor;
  let BigTimelockAdmin, MediumTimelockAdmin;

  before(async function () {
    await fixture(["Test"]);
    [deployer, user2] = await getSigners();
    ({ BigTimelockAdmin, MediumTimelockAdmin } = await getAdminSigners());

    positionManager = await getContract("PositionManager");
    errorsLibrary = await getContract("Errors");

    mockSpotTradingRewardDistributor = await deployMockSpotTradingRewardDistributor(deployer);
    mockKeeperRewardDistributor = await deployMockKeeperRewardDistributor(deployer);
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

  describe("setOracleTolerableLimitMultiplier", function () {
    it("Should allow only MEDIUM_TIMELOCK_ADMIN to setOracleTolerableLimitMultiplier", async function () {
      const newMultiplier = parseEther("1.2");
      await positionManager.connect(MediumTimelockAdmin).setOracleTolerableLimitMultiplier(newMultiplier);

      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(newMultiplier);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setOracleTolerableLimitMultiplier", async function () {
      const oldMultiplier = await positionManager.oracleTolerableLimitMultiplier();
      const newMultiplier = parseEther("1.2");
      await expect(positionManager.connect(user2).setOracleTolerableLimitMultiplier(newMultiplier)).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(oldMultiplier);
    });

    it("Should not setOracleTolerableLimitMultiplier if newMultiplier < WAD or newMultiplier >= 10 WAD", async function () {
      const multiplier1 = parseEther("0.5");
      const multiplier2 = parseEther("10");
      const oldMultiplier = await positionManager.oracleTolerableLimitMultiplier();

      await expect(positionManager.setOracleTolerableLimitMultiplier(multiplier1)).to.be.revertedWithCustomError(
        errorsLibrary,
        "WRONG_TRUSTED_MULTIPLIER",
      );
      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(oldMultiplier);

      await expect(positionManager.setOracleTolerableLimitMultiplier(multiplier2)).to.be.revertedWithCustomError(
        errorsLibrary,
        "WRONG_TRUSTED_MULTIPLIER",
      );
      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(oldMultiplier);
    });
  });

  describe("setSpotTradingRewardDistributor", function () {
    it("Should allow BIG_TIMELOCK_ADMIN to setSpotTradingRewardDistributor", async function () {
      const newSpotTradingRewardDistributor = mockSpotTradingRewardDistributor.address;
      await positionManager.connect(BigTimelockAdmin).setSpotTradingRewardDistributor(newSpotTradingRewardDistributor);
      const currentSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      expect(currentSpotTradingRewardDistributor).to.equal(newSpotTradingRewardDistributor);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setSpotTradingRewardDistributor", async function () {
      const oldSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      const newSpotTradingRewardDistributor = mockSpotTradingRewardDistributor.address;
      await expect(
        positionManager.connect(user2).setSpotTradingRewardDistributor(newSpotTradingRewardDistributor),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");

      const currentSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      expect(currentSpotTradingRewardDistributor).to.equal(oldSpotTradingRewardDistributor);
    });

    it("Should setSpotTradingRewardDistributor to zero address", async function () {
      await positionManager.setSpotTradingRewardDistributor(AddressZero);
      const currentSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      expect(currentSpotTradingRewardDistributor).to.equal(AddressZero);
    });
  });
  describe("Emitting events", function () {
    it("Should emit KeeperRewardDistributorChanged event when setKeeperRewardDistributor is successful", async function () {
      const newKeeperRewardDistributor = mockKeeperRewardDistributor.address;
      await expect(positionManager.connect(BigTimelockAdmin).setKeeperRewardDistributor(newKeeperRewardDistributor))
        .to.emit(positionManager, "KeeperRewardDistributorChanged")
        .withArgs(mockKeeperRewardDistributor.address);
    });

    it("Should emit MinPositionSizeAndAssetChanged event when setMinPositionSize is successful", async function () {
      const tokenWETH = await getContract("Wrapped Ether");
      await expect(positionManager.connect(MediumTimelockAdmin).setMinPositionSize(parseEther("6"), tokenWETH.address))
        .to.emit(positionManager, "MinPositionSizeAndAssetChanged")
        .withArgs(parseEther("6"), tokenWETH.address);
    });

    it("Should emit OracleTolerableLimitMultiplierChanged event when setOracleTolerableLimitMultiplier is successful", async function () {
      const newMultiplier = parseEther("1.2");
      await expect(positionManager.connect(MediumTimelockAdmin).setOracleTolerableLimitMultiplier(newMultiplier))
        .to.emit(positionManager, "OracleTolerableLimitMultiplierChanged")
        .withArgs(newMultiplier);
    });
  });
});
