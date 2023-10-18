// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  run,
  ethers: { getNamedSigners, getContract },
  deployments: { fixture },
} = require("hardhat");
const { deployMockBucketsFactory, deployMockAccessControl, deployMockPToken } = require("../utils/waffleMocks");
const { getImpersonateSigner } = require("../utils/hardhatUtils");

process.env.TEST = true;

describe("PTokensFactory_unit", function () {
  let mockBucketsFactory, mockBucketsFactorySigner, pTokensFactory, mockPToken;
  let registry;
  let ErrorsLibrary;
  let deployer, caller;
  let snapshotId;

  before(async function () {
    await fixture(["PTokensFactory"]);
    pTokensFactory = await getContract("PTokensFactory");
    registry = await getContract("Registry");
    ErrorsLibrary = await getContract("Errors");

    ({ deployer, caller } = await getNamedSigners());
    mockPToken = await deployMockPToken(deployer);
    mockBucketsFactory = await deployMockBucketsFactory(deployer);
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
        run("deploy:PTokensFactory", {
          registry: mockRegistry.address,
          errorsLibrary: ErrorsLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy if registry does not support IPtoken", async function () {
      const mockRegistry = await deployMockAccessControl(deployer);
      await mockPToken.mock.supportsInterface.returns(false);
      await expect(
        run("deploy:PTokensFactory", {
          registry: mockRegistry.address,
          ptokenImplementation: mockPToken.address,
          errorsLibrary: ErrorsLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should set registry during PTokensFactory contract deploy", async function () {
      const actualRegistryAddress = await pTokensFactory.registry();
      expect(registry.address).to.equal(actualRegistryAddress);
    });
  });

  describe("createPToken", function () {
    it("Should revert if called by not a BucketsFactory", async function () {
      await expect(pTokensFactory.createPToken("TestPToken", "TPT", 18)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_A_BUCKET_FACTORY",
      );
    });

    it("Should emit PTokenCreated event", async function () {
      await pTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const beaconInstance = await pTokensFactory.connect(mockBucketsFactorySigner).callStatic.createPToken("TestPToken", "TPT", 18);

      await expect(pTokensFactory.connect(mockBucketsFactorySigner).createPToken("TestPToken", "TPT", 18))
        .to.emit(pTokensFactory, "PTokenCreated")
        .withArgs(beaconInstance);
    });
  });

  describe("setBucketsFactory", function () {
    it("Should revert if called by not a BIG_TIMELOCK_ADMIN", async function () {
      await expect(pTokensFactory.connect(caller).setBucketsFactory(mockBucketsFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert if BucketsFactory address does not support IBucketsFactory", async function () {
      await mockBucketsFactory.mock.supportsInterface.returns(false);

      await expect(pTokensFactory.setBucketsFactory(mockBucketsFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should set BucketsFactory address", async function () {
      await pTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const actualBucketsFactoryAddress = await pTokensFactory.bucketsFactory();
      expect(mockBucketsFactory.address).to.equal(actualBucketsFactoryAddress);
    });
  });
  describe("upgradeTo", function () {
    it("Should revert if the passed contract does not support the interface", async function () {
      await mockPToken.mock.supportsInterface.returns(false);
      await expect(pTokensFactory.upgradeTo(mockPToken.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should upgradeTo with the correct address", async function () {
      const primexProxyAdmin = await getContract("PrimexProxyAdmin");
      await mockPToken.mock.supportsInterface.returns(true);
      await primexProxyAdmin.upgradeBeacon(pTokensFactory.address, mockPToken.address);
      expect(await pTokensFactory.implementation()).to.be.equal(mockPToken.address);
    });
  });
});
