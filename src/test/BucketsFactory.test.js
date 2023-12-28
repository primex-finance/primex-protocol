// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    provider: { getCode },
    utils: { defaultAbiCoder },
    constants: { AddressZero, MaxUint256 },
  },
  deployments: { fixture },
  upgrades,
} = require("hardhat");
const {
  deployMockPrimexDNS,
  deployMockReserve,
  deployMockAccessControl,
  deployMockPToken,
  deployMockPtokensFactory,
  deployMockDebtTokensFactory,
  deployMockDebtToken,
  deployMockPositionManager,
  deployMockPriceOracle,
  deployMockInterestRateStrategy,
  deployMockWhiteBlackList,
  deployMockBucket,
} = require("./utils/waffleMocks");

const { addressFromEvent } = require("./utils/addressFromEvent");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN } = require("../Constants");

const { barCalcParams } = require("./utils/defaultBarCalcParams");
const { BAR_CALC_PARAMS_DECODE } = require("./utils/constants");

process.env.TEST = true;

const feeBuffer = "1000200000000000000"; // 1.0002
const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
const reserveRate = "100000000000000000"; // 0.1 - 10%
const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

describe("BucketsFactory", function () {
  let bucketsFactory, deployer, bucketsFactoryContractFactory;
  let nameBucket, assets, risksThresholds, underlyingAsset;
  let mockPtokensFactory,
    mockNewPtokensFactory,
    mockPositionManager,
    mockPriceOracle,
    mockDebtTokensFactory,
    mockNewDebtTokensFactory,
    mockRegistry,
    mockPrimexDNS,
    mockReserve,
    mockPtoken,
    mockDebtToken,
    mockInterestRateStrategy,
    mockWhiteBlackList,
    mockBucket;
  let tokenTransfersLibrary;
  let tokenApproveLibrary;
  let ErrorsLibrary;
  let bucketImplementation;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer } = await getNamedSigners());
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    tokenApproveLibrary = await getContract("TokenApproveLibrary");
    ErrorsLibrary = await getContract("Errors");
  });

  beforeEach(async function () {
    mockRegistry = await deployMockAccessControl(deployer);
    mockPtoken = await deployMockPToken(deployer);
    mockDebtToken = await deployMockDebtToken(deployer);
    mockPtokensFactory = await deployMockPtokensFactory(deployer);
    mockNewPtokensFactory = await deployMockPtokensFactory(deployer);
    mockDebtTokensFactory = await deployMockDebtTokensFactory(deployer);
    mockNewDebtTokensFactory = await deployMockDebtTokensFactory(deployer);
    mockPrimexDNS = await deployMockPrimexDNS(deployer);
    mockReserve = await deployMockReserve(deployer);
    mockPositionManager = await deployMockPositionManager(deployer);
    [mockPriceOracle] = await deployMockPriceOracle(deployer);
    mockInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    mockBucket = await deployMockBucket(deployer);

    await mockPtokensFactory.mock.createPToken.returns(mockPtoken.address);
    await mockDebtTokensFactory.mock.createDebtToken.returns(mockDebtToken.address);

    bucketImplementation = await getContract("Bucket");

    bucketsFactoryContractFactory = await getContractFactory("BucketsFactory");
    bucketsFactory = await bucketsFactoryContractFactory.deploy(
      mockRegistry.address,
      mockPtokensFactory.address,
      mockDebtTokensFactory.address,
      bucketImplementation.address,
    );
    await bucketsFactory.deployed();

    // create bucket params
    nameBucket = "bucket1";
    assets = [];
    risksThresholds = [];
    underlyingAsset = (await getContract("TestTokenA")).address;
  });

  async function txCreateBucket() {
    return bucketsFactory.createBucket({
      nameBucket: nameBucket,
      positionManager: mockPositionManager.address,
      priceOracle: mockPriceOracle.address,
      dns: mockPrimexDNS.address,
      reserve: mockReserve.address,
      assets: assets,
      whiteBlackList: mockWhiteBlackList.address,
      pairPriceDrops: risksThresholds,
      underlyingAsset: underlyingAsset,
      feeBuffer: feeBuffer,
      withdrawalFeeRate: withdrawalFeeRate,
      reserveRate: reserveRate,
      liquidityMiningRewardDistributor: AddressZero,
      liquidityMiningAmount: 0,
      liquidityMiningDeadline: 0,
      stabilizationDuration: 0,
      interestRateStrategy: mockInterestRateStrategy.address,
      maxAmountPerUser: 0,
      estimatedBar: estimatedBar,
      estimatedLar: estimatedLar,
      barCalcParams: defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]),
      maxTotalDeposit: MaxUint256,
    });
  }

  it("constructor", async function () {
    expect(await bucketsFactory.pTokensFactory()).to.equal(mockPtokensFactory.address);
    expect(await bucketsFactory.debtTokensFactory()).to.equal(mockDebtTokensFactory.address);
  });

  it("Should revert deploy when Bucket address is not supported", async function () {
    await mockBucket.mock.supportsInterface.returns(false);
    await expect(
      bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        mockBucket.address,
      ),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
  });

  it("should createBucket if right access", async function () {
    expect(await txCreateBucket());
  });

  it("should revert deploy BucketsFactory if registry address does not support IAccessControl", async function () {
    await mockRegistry.mock.supportsInterface.returns(false);

    await expect(
      bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      ),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
  });

  it("should revert deploy BucketsFactory if PtokensFactory address does not support IPTokensFactory", async function () {
    await mockPtokensFactory.mock.supportsInterface.returns(false);

    await expect(
      bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      ),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
  });

  it("should revert deploy BucketsFactory if DebtTokensFactory address does not support IDebtTokensFactory", async function () {
    await mockDebtTokensFactory.mock.supportsInterface.returns(false);

    await expect(
      bucketsFactoryContractFactory.deploy(
        mockRegistry.address,
        mockPtokensFactory.address,
        mockDebtTokensFactory.address,
        bucketImplementation.address,
      ),
    ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
  });

  it("should revert if not MEDIUM_TIMELOCK_ADMIN call createBucket", async function () {
    await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(false);
    await expect(txCreateBucket()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
  });

  it("should revert createBucket if PositionManager address does not support IPositionManager", async function () {
    await mockPositionManager.mock.supportsInterface.returns(false);
    await expect(txCreateBucket()).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
  });

  it("should revert createBucket if Reserve address does not support IReserve", async function () {
    await mockReserve.mock.supportsInterface.returns(false);
    await expect(txCreateBucket()).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
  });

  it("Emits BucketCreated and BucketLaunched if a bucket is created and initially launched", async function () {
    const tx = await txCreateBucket();

    const bucketAddress = await bucketsFactory.buckets(0);
    const bucket = await getContractAt("Bucket", bucketAddress);
    await expect(tx).to.emit(bucketsFactory, "BucketCreated").withArgs(bucketAddress).to.emit(bucket, "BucketLaunched");
  });

  it("should revert when trying to access a non-existent bucket", async function () {
    const tx = await txCreateBucket();
    const txSuccess = await tx.wait();

    const newBucketAddress = addressFromEvent("BucketCreated", txSuccess);
    expect(await bucketsFactory.buckets(0)).to.equal(newBucketAddress);
    await expect(bucketsFactory.buckets(1)).to.be.reverted;
  });

  it("should return appropriate length of allBuckets[] if several buckets were created", async function () {
    const tx1 = await txCreateBucket();
    const tx1Success = await tx1.wait();

    const tx2 = await txCreateBucket();
    const tx2Success = await tx2.wait();

    const tx3 = await txCreateBucket();
    const tx3Success = await tx3.wait();

    const newBucketAddress1 = addressFromEvent("BucketCreated", tx1Success);
    const newBucketAddress2 = addressFromEvent("BucketCreated", tx2Success);
    const newBucketAddress3 = addressFromEvent("BucketCreated", tx3Success);
    const allBuckets = await bucketsFactory.allBuckets();

    expect(allBuckets.length).to.equal(3);
    expect(allBuckets[0]).to.equal(newBucketAddress1);
    expect(allBuckets[1]).to.equal(newBucketAddress2);
    expect(allBuckets[2]).to.equal(newBucketAddress3);
  });

  it("should create a Bucket contract code", async function () {
    const tx = await txCreateBucket();
    const txSuccess = await tx.wait();

    const newBucketAddress = addressFromEvent("BucketCreated", txSuccess);
    expect(await getCode(newBucketAddress)).not.equal("0x");
  });

  it("should upgrade Bucket implementation", async function () {
    const tx = await txCreateBucket();
    const txSuccess = await tx.wait();
    const bucketAddress = addressFromEvent("BucketCreated", txSuccess);
    const oldImpl = await bucketsFactory.implementation();
    const bucketV2Factory = await getContractFactory("BucketV2", {
      libraries: {
        TokenTransfersLibrary: tokenTransfersLibrary.address,
        TokenApproveLibrary: tokenApproveLibrary.address,
      },
    });
    const oldImplFactory = await getContractFactory("Bucket", {
      libraries: {
        TokenTransfersLibrary: tokenTransfersLibrary.address,
        TokenApproveLibrary: tokenApproveLibrary.address,
      },
    });

    await upgrades.forceImport(bucketsFactory.address, oldImplFactory, { kind: "beacon" });
    await upgrades.upgradeBeacon(bucketsFactory, bucketV2Factory, {
      unsafeAllow: ["delegatecall", "external-library-linking", "constructor"],
    });

    const newImpl = await bucketsFactory.implementation();

    expect(newImpl).not.to.equal(oldImpl);
    const bucket = await getContractAt("BucketV2", bucketAddress);
    expect(await bucket.testUpgrade()).to.equal("BucketV2");
  });

  describe("upgradeTo", function () {
    it("Should revert if the passed contract does not support the interface", async function () {
      await mockBucket.mock.supportsInterface.returns(false);
      await expect(bucketsFactory.upgradeTo(mockBucket.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should upgradeTo with the correct address", async function () {
      await mockBucket.mock.supportsInterface.returns(true);
      await bucketsFactory.upgradeTo(mockBucket.address);
      expect(await bucketsFactory.implementation()).to.be.equal(mockBucket.address);
    });
  });

  describe("setPTokensFactory", function () {
    it("Should set pTokens factory", async function () {
      await bucketsFactory.setPTokensFactory(mockNewPtokensFactory.address);

      expect(await bucketsFactory.pTokensFactory()).to.equal(mockNewPtokensFactory.address);
      await expect(bucketsFactory.setPTokensFactory(mockNewPtokensFactory.address))
        .to.emit(bucketsFactory, "PTokensFactoryChanged")
        .withArgs(mockNewPtokensFactory.address);
    });
    it("Should revert when new pTokensFactory address not supported", async function () {
      await mockNewPtokensFactory.mock.supportsInterface.returns(false);
      await expect(bucketsFactory.setPTokensFactory(mockNewPtokensFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should revert if not BIG_TIMELOCK_ADMIN call setPTokensFactory", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, deployer.address).returns(false);
      await expect(bucketsFactory.setPTokensFactory(mockNewPtokensFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });

  describe("setDebtTokensFactory", function () {
    it("Should set debtTokens factory", async function () {
      await bucketsFactory.setDebtTokensFactory(mockNewDebtTokensFactory.address);

      expect(await bucketsFactory.debtTokensFactory()).to.equal(mockNewDebtTokensFactory.address);
      await expect(bucketsFactory.setDebtTokensFactory(mockNewDebtTokensFactory.address))
        .to.emit(bucketsFactory, "DebtTokensFactoryChanged")
        .withArgs(mockNewDebtTokensFactory.address);
    });
    it("Should revert when new debtTokensFactory address not supported", async function () {
      await mockNewDebtTokensFactory.mock.supportsInterface.returns(false);
      await expect(bucketsFactory.setDebtTokensFactory(mockNewDebtTokensFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should revert if not BIG_TIMELOCK_ADMIN call setDebtTokensFactory", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, deployer.address).returns(false);
      await expect(bucketsFactory.setDebtTokensFactory(mockNewDebtTokensFactory.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
});
