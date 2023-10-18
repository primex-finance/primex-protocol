// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const { parseEther } = require("ethers/lib/utils");
const {
  network,
  ethers: { getContract, getContractFactory, getSigners },
  deployments: { fixture },
} = require("hardhat");

const { deployMockPMXToken, deployMockAccessControl } = require("../utils/waffleMocks");
const { BIG_TIMELOCK_ADMIN, EMERGENCY_ADMIN, SMALL_TIMELOCK_ADMIN } = require("../../Constants");

process.env.TEST = true;
describe("Redeemer_unit", function () {
  let deployer, recipient, recipient2, recipient3;
  let ErrorsLibrary, RedeemerFactory, Redeemer, earlyPmx, pmx, registry, tokenTransfersLibrary;
  let snapshotId;
  before(async function () {
    await fixture(["Errors", "TokenTransfersLibrary"]);
    ErrorsLibrary = await getContract("Errors");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    [deployer, recipient, recipient2, recipient3] = await getSigners();

    RedeemerFactory = await getContractFactory("Redeemer", {
      libraries: {
        TokenTransfersLibrary: tokenTransfersLibrary.address,
      },
    });
    earlyPmx = await deployMockPMXToken(deployer);
    pmx = await deployMockPMXToken(deployer);
    registry = await deployMockAccessControl(deployer);
    await registry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, recipient.address).returns(false);
    await registry.mock.hasRole.withArgs(EMERGENCY_ADMIN, recipient2.address).returns(false);
    await registry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, recipient3.address).returns(false);

    Redeemer = await RedeemerFactory.deploy(earlyPmx.address, pmx.address, registry.address);
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
  describe("deploy", function () {
    it("Should revert when earlyPmx is not supported", async function () {
      await earlyPmx.mock.supportsInterface.returns(false);
      await expect(RedeemerFactory.deploy(earlyPmx.address, pmx.address, registry.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should revert when pmx is not supported", async function () {
      await pmx.mock.supportsInterface.returns(false);
      await expect(RedeemerFactory.deploy(earlyPmx.address, pmx.address, registry.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert when registry is not supported", async function () {
      await registry.mock.supportsInterface.returns(false);
      await expect(RedeemerFactory.deploy(earlyPmx.address, pmx.address, registry.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should deploy", async function () {
      await earlyPmx.mock.supportsInterface.returns(true);
      await pmx.mock.supportsInterface.returns(true);
      await registry.mock.supportsInterface.returns(true);

      const redeemer = await RedeemerFactory.deploy(earlyPmx.address, pmx.address, registry.address);
      expect(await redeemer.earlyPmx()).to.be.equal(earlyPmx.address);
      expect(await redeemer.pmx()).to.be.equal(pmx.address);
      expect(await redeemer.registry()).to.be.equal(registry.address);
    });
  });
  describe("changeRate", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call changeRate", async function () {
      await expect(Redeemer.connect(recipient).changeRate(parseEther("2"))).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if the rate is zero", async function () {
      await expect(Redeemer.changeRate(0)).to.be.revertedWithCustomError(ErrorsLibrary, "ZERO_EXCHANGE_RATE");
    });
    it("Should change rate", async function () {
      await Redeemer.changeRate(parseEther("2"));
      expect(await Redeemer.rate()).to.be.equal(parseEther("2"));
    });
    it("Should emit RateChanged when change is successful", async function () {
      const rate = parseEther("2");
      await expect(Redeemer.changeRate(rate)).to.emit(Redeemer, "RateChanged").withArgs(rate);
    });
  });
  describe("pause and unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(Redeemer.connect(recipient2).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(Redeemer.connect(recipient3).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
