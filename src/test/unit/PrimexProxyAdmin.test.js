// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: { getNamedSigners, getContractFactory },
} = require("hardhat");
const { deployMockAccessControl, deployMockProxy, deployUpgradeableBeacon } = require("../utils/waffleMocks");
const { BIG_TIMELOCK_ADMIN } = require("../../Constants");

process.env.TEST = true;

describe("PrimexProxyAdmin_unit", function () {
  let errorsLibrary, primexProxyAdminFactory, primexProxyAdmin;
  let deployer, caller, recipient;
  let mockRegistry, mockProxy, mockBeacon, mockImplementation;
  let snapshotId;

  before(async function () {
    errorsLibrary = await getContractFactory("Errors");

    ({ deployer, caller, recipient } = await getNamedSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    mockProxy = await deployMockProxy(deployer);
    mockBeacon = await deployUpgradeableBeacon(deployer);
    mockImplementation = recipient;

    await mockRegistry.mock.hasRole.returns(false);
    await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, deployer.address).returns(true);

    primexProxyAdminFactory = await getContractFactory("PrimexProxyAdmin");
    primexProxyAdmin = await primexProxyAdminFactory.deploy(mockRegistry.address);
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
    it("Should revert initialize when the registry is not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(primexProxyAdminFactory.deploy(mockRegistry.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should set right vars", async function () {
      expect(await primexProxyAdmin.owner()).to.equal(primexProxyAdmin.address);
      expect(await primexProxyAdmin.registry()).to.equal(mockRegistry.address);
    });
  });

  describe("changeProxyAdmin", function () {
    it("Should revert not BIG_TIMELOCK_ADMIN call changeProxyAdmin", async function () {
      await expect(
        primexProxyAdmin.connect(caller).changeProxyAdmin(mockProxy.address, mockImplementation.address),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("Should change proxy admin", async function () {
      await primexProxyAdmin.changeProxyAdmin(mockProxy.address, mockImplementation.address);
    });
  });
  describe("changeBeaconProxyAdmin", function () {
    it("Should revert not BIG_TIMELOCK_ADMIN call changeBeaconProxyAdmin", async function () {
      await expect(
        primexProxyAdmin.connect(caller).changeBeaconProxyAdmin(mockBeacon.address, mockImplementation.address),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("Should change beacon proxy admin", async function () {
      await primexProxyAdmin.changeBeaconProxyAdmin(mockBeacon.address, mockImplementation.address);
    });
  });
  describe("upgrade", function () {
    it("Should revert not BIG_TIMELOCK_ADMIN call upgrade", async function () {
      await expect(primexProxyAdmin.connect(caller).upgrade(mockProxy.address, mockImplementation.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should upgrade proxy implementation", async function () {
      await primexProxyAdmin.upgrade(mockProxy.address, mockImplementation.address);
    });
  });
  describe("upgradeBeacon", function () {
    it("Should revert not BIG_TIMELOCK_ADMIN call upgrade", async function () {
      await expect(
        primexProxyAdmin.connect(caller).upgradeBeacon(mockBeacon.address, mockImplementation.address),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should upgrade beacon implementation", async function () {
      await primexProxyAdmin.upgradeBeacon(mockBeacon.address, mockImplementation.address);
    });
  });
  describe("upgradeAndCall", function () {
    it("Should revert not BIG_TIMELOCK_ADMIN call upgradeAndCall", async function () {
      await expect(
        primexProxyAdmin.connect(caller).upgradeAndCall(mockProxy.address, mockImplementation.address, "0x00"),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("Should transfer pmx from msg.sender in activityRewardDistributor", async function () {
      await primexProxyAdmin.upgradeAndCall(mockProxy.address, mockImplementation.address, "0x00");
    });
  });
});
