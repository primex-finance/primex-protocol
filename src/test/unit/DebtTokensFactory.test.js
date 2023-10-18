// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  run,
  ethers: { getNamedSigners, getContract },
  deployments: { fixture },
} = require("hardhat");
const { deployMockBucketsFactory, deployMockAccessControl, deployMockDebtToken } = require("../utils/waffleMocks");
const { getImpersonateSigner } = require("../utils/hardhatUtils");

process.env.TEST = true;

describe("DebtTokensFactory_unit", function () {
  let mockBucketsFactory, mockBucketsFactorySigner, debtTokensFactory, mockDebtToken;
  let registry;
  let ErrorsLibrary;
  let deployer, caller;
  let snapshotId;

  before(async function () {
    await fixture(["DebtTokensFactory"]);
    debtTokensFactory = await getContract("DebtTokensFactory");
    registry = await getContract("Registry");
    ErrorsLibrary = await getContract("Errors");

    ({ deployer, caller } = await getNamedSigners());
    mockBucketsFactory = await deployMockBucketsFactory(deployer);
    mockDebtToken = await deployMockDebtToken(deployer);
    mockBucketsFactorySigner = await getImpersonateSigner(mockBucketsFactory);
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
    it("Should revert deploy if registry does not support IAccessControl", async function () {
      const mockRegistry = await deployMockAccessControl(deployer);
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        run("deploy:DebtTokensFactory", {
          registry: mockRegistry.address,
          errorsLibrary: ErrorsLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy if registry does not support IDebtToken", async function () {
      const mockRegistry = await deployMockAccessControl(deployer);
      await mockDebtToken.mock.supportsInterface.returns(false);
      await expect(
        run("deploy:DebtTokensFactory", {
          registry: mockRegistry.address,
          debtTokenImplementation: mockDebtToken.address,
          errorsLibrary: ErrorsLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should set registry during DebtTokensFactory contract deploy", async function () {
      const actualRegistryAddress = await debtTokensFactory.registry();
      expect(registry.address).to.equal(actualRegistryAddress);
    });
  });

  describe("createDebtToken", function () {
    it("Should revert if called by not a BucketsFactory", async function () {
      await expect(debtTokensFactory.createDebtToken("TestDebtToken", "TDT", 18)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_A_BUCKET_FACTORY",
      );
    });

    it("Should emit DebtTokenCreated event", async function () {
      await debtTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const beaconInstance = await debtTokensFactory
        .connect(mockBucketsFactorySigner)
        .callStatic.createDebtToken("TestDebtToken", "TDT", 18);

      await expect(debtTokensFactory.connect(mockBucketsFactorySigner).createDebtToken("TestDebtToken", "TDT", 18))
        .to.emit(debtTokensFactory, "DebtTokenCreated")
        .withArgs(beaconInstance);
    });
  });

  describe("setBucketsFactory", function () {
    it("Should revert if called by not a BIG_TIMELOCK_ADMIN", async function () {
      await expect(debtTokensFactory.connect(caller).setBucketsFactory(mockBucketsFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert if BucketsFactory address does not support IBucketsFactory", async function () {
      await mockBucketsFactory.mock.supportsInterface.returns(false);

      await expect(debtTokensFactory.setBucketsFactory(mockBucketsFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should set BucketsFactory address", async function () {
      await debtTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const actualBucketsFactoryAddress = await debtTokensFactory.bucketsFactory();
      expect(mockBucketsFactory.address).to.equal(actualBucketsFactoryAddress);
    });
  });
  describe("upgradeTo", function () {
    it("Should revert if the passed contract does not support the interface", async function () {
      await mockDebtToken.mock.supportsInterface.returns(false);
      await expect(debtTokensFactory.upgradeTo(mockDebtToken.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should upgradeTo with the correct address", async function () {
      const primexProxyAdmin = await getContract("PrimexProxyAdmin");
      await mockDebtToken.mock.supportsInterface.returns(true);
      await primexProxyAdmin.upgradeBeacon(debtTokensFactory.address, mockDebtToken.address);
      expect(await debtTokensFactory.implementation()).to.be.equal(mockDebtToken.address);
    });
  });
});
