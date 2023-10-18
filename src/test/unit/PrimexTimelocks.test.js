// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getNamedSigners,
    getContractFactory,
    constants: { AddressZero, HashZero },
    utils: { keccak256, toUtf8Bytes, defaultAbiCoder },
  },
} = require("hardhat");
const { deployMockAccessControl } = require("../utils/waffleMocks");
const { SECONDS_PER_DAY } = require("../utils/activityRewardDistributorMath");
const { GUARDIAN_ADMIN } = require("../../Constants");

process.env.TEST = true;

describe("PrimexTimelock_unit", function () {
  let primexTimelock, PrimexTimelockFactory, errorsLibrary, mockRegistry;
  let args, operationArgs, executeArgs, operationBatchArgs, executeBatchArgs;
  let caller, deployer, snapshotId;

  before(async function () {
    errorsLibrary = await getContractFactory("Errors");

    ({ deployer, caller } = await getNamedSigners());
    PrimexTimelockFactory = await getContractFactory("PrimexTimelock");
    mockRegistry = await deployMockAccessControl(deployer);

    args = [SECONDS_PER_DAY, [deployer.address], [deployer.address], AddressZero, mockRegistry.address];
    primexTimelock = await PrimexTimelockFactory.deploy(...args);

    operationArgs = [primexTimelock.address, 0, HashZero, HashZero, HashZero, SECONDS_PER_DAY];
    executeArgs = [...operationArgs];
    executeArgs.pop();

    operationBatchArgs = [[primexTimelock.address], [0], [HashZero], HashZero, HashZero, SECONDS_PER_DAY];
    executeBatchArgs = [...operationBatchArgs];
    executeBatchArgs.pop();
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

  it("updateDelay is not supported", async function () {
    await expect(primexTimelock.updateDelay(100)).to.be.revertedWithCustomError(errorsLibrary, "OPERATION_NOT_SUPPORTED");
  });

  it("schedule revert if timelock is paused", async function () {
    await primexTimelock.pause();
    await expect(primexTimelock.schedule(...operationArgs)).to.be.revertedWith("Pausable: paused");
  });

  it("scheduleBatch revert if timelock is paused", async function () {
    await primexTimelock.pause();
    await expect(primexTimelock.scheduleBatch(...operationBatchArgs)).to.be.revertedWith("Pausable: paused");
  });

  it("execute revert if timelock is paused", async function () {
    await primexTimelock.pause();
    await expect(primexTimelock.execute(...executeArgs)).to.be.revertedWith("Pausable: paused");
  });

  it("executeBatch revert if timelock is paused", async function () {
    await primexTimelock.pause();
    await expect(primexTimelock.executeBatch(...executeBatchArgs)).to.be.revertedWith("Pausable: paused");
  });
  describe("constructor", function () {
    it("Should deploy", async function () {
      const timelock = await PrimexTimelockFactory.deploy(...args);
      expect(await timelock.registry()).to.equal(mockRegistry.address);
    });
    it("Should revert initialize when the registry is not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(PrimexTimelockFactory.deploy(...args)).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("cancel", function () {
    let hashOperation, CANCELLER_ROLE;
    before(async function () {
      await primexTimelock.schedule(...operationArgs);
      hashOperation = keccak256(defaultAbiCoder.encode(["address", "uint256", "bytes", "bytes32", "bytes32"], executeArgs));
      CANCELLER_ROLE = keccak256(toUtf8Bytes("CANCELLER_ROLE"));
    });
    it("Should revert if the caller doesn't have CANCELLER_ROLE", async function () {
      await mockRegistry.mock.hasRole.returns(false);
      await expect(primexTimelock.connect(caller).cancel(hashOperation)).to.be.revertedWith(
        `AccessControl: account ${caller.address.toLowerCase()} is missing role ${CANCELLER_ROLE}`,
      );
    });

    it("Should cancel operation and don't give to caller CANCELLER_ROLE if caller has GUARDIAN_ADMIN", async function () {
      await mockRegistry.mock.hasRole.returns(true);

      expect(await primexTimelock.hasRole(CANCELLER_ROLE, caller.address)).to.equal(false);
      await primexTimelock.connect(caller).cancel(hashOperation);
      expect(await primexTimelock.hasRole(CANCELLER_ROLE, caller.address)).to.equal(false);
    });
  });

  describe("pause & unpause", function () {
    it("Should revert if not GUARDIAN_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(GUARDIAN_ADMIN, caller.address).returns(false);
      await expect(primexTimelock.connect(caller).pause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not GUARDIAN_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.withArgs(GUARDIAN_ADMIN, caller.address).returns(false);
      await expect(primexTimelock.connect(caller).unpause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
  });
});
