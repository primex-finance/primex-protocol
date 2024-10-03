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
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
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
      const { payload } = await encodeFunctionData("setOracleTolerableLimitMultiplier", [newMultiplier], "PositionManagerExtension");
      await positionManager.connect(MediumTimelockAdmin).setProtocolParamsByAdmin(payload);

      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(newMultiplier);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setOracleTolerableLimitMultiplier", async function () {
      const oldMultiplier = await positionManager.oracleTolerableLimitMultiplier();
      const newMultiplier = parseEther("1.2");
      const { payload } = await encodeFunctionData("setOracleTolerableLimitMultiplier", [newMultiplier], "PositionManagerExtension");
      await expect(positionManager.connect(user2).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(oldMultiplier);
    });

    it("Should not setOracleTolerableLimitMultiplier if newMultiplier < WAD or newMultiplier >= 10 WAD", async function () {
      const multiplier1 = parseEther("0.5");
      const multiplier2 = parseEther("10");
      const oldMultiplier = await positionManager.oracleTolerableLimitMultiplier();
      const { payload: payload1 } = await encodeFunctionData(
        "setOracleTolerableLimitMultiplier",
        [multiplier1],
        "PositionManagerExtension",
      );
      const { payload: payload2 } = await encodeFunctionData(
        "setOracleTolerableLimitMultiplier",
        [multiplier2],
        "PositionManagerExtension",
      );

      await expect(positionManager.setProtocolParamsByAdmin(payload1)).to.be.revertedWithCustomError(
        errorsLibrary,
        "WRONG_TRUSTED_MULTIPLIER",
      );
      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(oldMultiplier);

      await expect(positionManager.setProtocolParamsByAdmin(payload2)).to.be.revertedWithCustomError(
        errorsLibrary,
        "WRONG_TRUSTED_MULTIPLIER",
      );
      expect(await positionManager.oracleTolerableLimitMultiplier()).to.equal(oldMultiplier);
    });
  });

  describe("setSpotTradingRewardDistributor", function () {
    it("Should allow BIG_TIMELOCK_ADMIN to setSpotTradingRewardDistributor", async function () {
      const newSpotTradingRewardDistributor = mockSpotTradingRewardDistributor.address;
      const { payload } = await encodeFunctionData(
        "setSpotTradingRewardDistributor",
        [newSpotTradingRewardDistributor],
        "PositionManagerExtension",
      );
      await positionManager.connect(BigTimelockAdmin).setProtocolParamsByAdmin(payload);
      const currentSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      expect(currentSpotTradingRewardDistributor).to.equal(newSpotTradingRewardDistributor);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setSpotTradingRewardDistributor", async function () {
      const oldSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      const newSpotTradingRewardDistributor = mockSpotTradingRewardDistributor.address;
      const { payload } = await encodeFunctionData(
        "setSpotTradingRewardDistributor",
        [newSpotTradingRewardDistributor],
        "PositionManagerExtension",
      );
      await expect(positionManager.connect(user2).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );

      const currentSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      expect(currentSpotTradingRewardDistributor).to.equal(oldSpotTradingRewardDistributor);
    });

    it("Should setSpotTradingRewardDistributor to zero address", async function () {
      const { payload } = await encodeFunctionData("setSpotTradingRewardDistributor", [AddressZero], "PositionManagerExtension");
      await positionManager.connect(BigTimelockAdmin).setProtocolParamsByAdmin(payload);
      const currentSpotTradingRewardDistributor = await positionManager.spotTradingRewardDistributor();
      expect(currentSpotTradingRewardDistributor).to.equal(AddressZero);
    });
  });
  describe("Emitting events", function () {
    it("Should emit KeeperRewardDistributorChanged event when setKeeperRewardDistributor is successful", async function () {
      const newKeeperRewardDistributor = mockKeeperRewardDistributor.address;
      const { payload } = await encodeFunctionData("setKeeperRewardDistributor", [newKeeperRewardDistributor], "PositionManagerExtension");
      await expect(positionManager.connect(BigTimelockAdmin).setProtocolParamsByAdmin(payload))
        .to.emit(positionManager, "KeeperRewardDistributorChanged")
        .withArgs(mockKeeperRewardDistributor.address);
    });

    it("Should emit OracleTolerableLimitMultiplierChanged event when setOracleTolerableLimitMultiplier is successful", async function () {
      const newMultiplier = parseEther("1.2");
      const { payload } = await encodeFunctionData("setOracleTolerableLimitMultiplier", [newMultiplier], "PositionManagerExtension");
      await expect(positionManager.connect(MediumTimelockAdmin).setProtocolParamsByAdmin(payload))
        .to.emit(positionManager, "OracleTolerableLimitMultiplierChanged")
        .withArgs(newMultiplier);
    });
  });
});
