// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { getAdminSigners } = require("../utils/hardhatUtils");
const {
  deployMockAccessControl,
  deployMockERC20,
  deployMockBucket,
  deployMockPrimexDNS,
  deployMockPriceOracle,
  deployMockWhiteBlackList,
  deployMockTiersManager,
} = require("../utils/waffleMocks");
const { SECONDS_PER_DAY } = require("../../Constants.js");
process.env.TEST = true;

describe("DepositManager_unit", function () {
  let depositManager, primexDNS, registry, tokenTransfersLibrary, primexPricingLibrary, snapshotId;
  let priceOracle, rewardParameters;
  let deployer, caller, SmallTimelockAdmin, BigTimelockAdmin;
  let mockRegistry, mockPrimexDns, mockPriceOracle, mockWhiteBlackList, mockPToken, mockTiersManager;
  let mockBucket;

  let ErrorsLibrary;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, caller } = await getNamedSigners());
    ({ SmallTimelockAdmin, BigTimelockAdmin } = await getAdminSigners());
    depositManager = await getContract("DepositManager");
    primexDNS = await getContract("PrimexDNS");
    registry = await getContract("Registry");
    priceOracle = await getContract("PriceOracle");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    ErrorsLibrary = await getContract("Errors");
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    mockRegistry = await deployMockAccessControl(deployer);
    mockPrimexDns = await deployMockPrimexDNS(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    mockTiersManager = await deployMockTiersManager(deployer);
    [mockPriceOracle] = await deployMockPriceOracle(deployer);
    mockBucket = await deployMockBucket(deployer);
    await mockBucket.mock.name.returns("bucket");
    const mockBucket2 = await deployMockBucket(deployer);
    await mockBucket2.mock.name.returns("bucket2");
    const mockRewardToken = await deployMockERC20(deployer);
    const mockRewardToken2 = await deployMockERC20(caller);
    mockPToken = await deployMockERC20(caller);
    await mockBucket.mock.pToken.returns(mockPToken.address);
    await mockBucket2.mock.pToken.returns(mockPToken.address);
    const DepositManagerConfig = [
      {
        bucketAddress: mockBucket.address,
        rewardTokens: [
          {
            rewardTokenAddress: mockRewardToken.address,
            durations: [
              {
                durationInDays: 20,
                newInterestRate: "0.05",
              },
              {
                durationInDays: 15,
                newInterestRate: "0.06",
              },
            ],
          },
          {
            rewardTokenAddress: mockRewardToken2.address,
            durations: [
              {
                durationInDays: 20,
                newInterestRate: "0.05",
              },
              {
                durationInDays: 15,
                newInterestRate: "0.06",
              },
            ],
          },
        ],
        maxTotalDeposit: "100",
      },
      {
        bucketAddress: mockBucket2.address,
        rewardTokens: [
          {
            rewardTokenAddress: mockRewardToken.address,
            durations: [
              {
                durationInDays: 20,
                newInterestRate: "0.05",
              },
              {
                durationInDays: 15,
                newInterestRate: "0.06",
              },
            ],
          },
          {
            rewardTokenAddress: mockRewardToken2.address,
            durations: [
              {
                durationInDays: 20,
                newInterestRate: "0.05",
              },
              {
                durationInDays: 15,
                newInterestRate: "0.06",
              },
            ],
          },
        ],
        maxTotalDeposit: "200",
      },
    ];

    rewardParameters = [];

    for (const bucket of DepositManagerConfig) {
      const bucketRewardTokens = [];
      const bucketDurations = [];
      const bucketNewInterestRates = [];

      for (const token of bucket.rewardTokens) {
        const tokenDurations = [];
        const tokenNewInterestRates = [];
        for (const duration of token.durations) {
          tokenDurations.push(duration.durationInDays * SECONDS_PER_DAY);
          tokenNewInterestRates.push(parseEther(duration.newInterestRate).toString());
        }
        bucketRewardTokens.push(token.rewardTokenAddress);
        bucketDurations.push(tokenDurations);
        bucketNewInterestRates.push(tokenNewInterestRates);
      }
      rewardParameters.push({
        bucket: bucket.bucketAddress,
        rewardTokens: bucketRewardTokens,
        durations: bucketDurations,
        newInterestRates: bucketNewInterestRates,
        maxTotalDeposit: bucket.maxTotalDeposit,
      });
    }
  });

  describe("initialize", function () {
    let DepositManagerFactory, args, deployDM;
    before(async function () {
      DepositManagerFactory = await getContractFactory("DepositManager", {
        libraries: {
          TokenTransfersLibrary: tokenTransfersLibrary.address,
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      deployDM = async function deployDM(args) {
        return await upgrades.deployProxy(DepositManagerFactory, [...args], {
          unsafeAllow: ["constructor", "delegatecall", "external-library-linking"],
        });
      };

      // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
      await upgrades.silenceWarnings();
    });

    beforeEach(async function () {
      args = [registry.address, primexDNS.address, priceOracle.address, mockWhiteBlackList.address];
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
      const swapManager = await deployDM(args);
      expect(await swapManager.registry()).to.be.equal(registry.address);
      expect(await swapManager.primexDNS()).to.be.equal(primexDNS.address);
      expect(await swapManager.priceOracle()).to.be.equal(priceOracle.address);
      expect(await swapManager.whiteBlackList()).to.be.equal(mockWhiteBlackList.address);
    });

    it("Should revert deploy when registry address not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      args[0] = mockRegistry.address;
      await expect(deployDM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when dns address not supported", async function () {
      await mockPrimexDns.mock.supportsInterface.returns(false);
      args[1] = mockPrimexDns.address;
      await expect(deployDM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when priceOracle address not supported", async function () {
      await mockPriceOracle.mock.supportsInterface.returns(false);
      args[2] = mockPriceOracle.address;
      await expect(deployDM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy when WhiteBlackList address not supported", async function () {
      await mockWhiteBlackList.mock.supportsInterface.returns(false);
      args[3] = mockWhiteBlackList.address;
      await expect(deployDM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("setRewardParameters", function () {
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

    it("Should allow only SMALL_TIMELOCK_ADMIN to setRewardParameters", async function () {
      await depositManager.connect(SmallTimelockAdmin).setRewardParameters(rewardParameters);
    });

    it("Should revert if not SMALL_TIMELOCK_ADMIN call setRewardParameters", async function () {
      await expect(depositManager.connect(caller).setRewardParameters(rewardParameters)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert if rewardTokens length mismatch with durations length ", async function () {
      const modifiedRewardParameters = JSON.parse(JSON.stringify(rewardParameters));
      modifiedRewardParameters[0].durations[1].push(30 * SECONDS_PER_DAY);
      await expect(depositManager.connect(SmallTimelockAdmin).setRewardParameters(modifiedRewardParameters)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });

    it("Should revert if rewardTokens length mismatch with interesRates length ", async function () {
      const modifiedRewardParameters = JSON.parse(JSON.stringify(rewardParameters));
      modifiedRewardParameters[0].newInterestRates[1].push(parseEther("0.2").toString());
      await expect(depositManager.connect(SmallTimelockAdmin).setRewardParameters(modifiedRewardParameters)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });

    it("Should revert if durations length mismatch with interesRates length", async function () {
      const modifiedRewardParameters = JSON.parse(JSON.stringify(rewardParameters));

      modifiedRewardParameters[0].newInterestRates[1].push(parseEther("0.02").toString());

      await expect(depositManager.connect(SmallTimelockAdmin).setRewardParameters(modifiedRewardParameters)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "PARAMS_LENGTH_MISMATCH",
      );
    });

    it("Should correctly set rewardTokens and emit event RewardTokenAdded", async function () {
      await expect(depositManager.connect(SmallTimelockAdmin).setRewardParameters(rewardParameters))
        .to.emit(depositManager, "RewardTokenAdded")
        .withArgs(rewardParameters[0].bucket, rewardParameters[0].rewardTokens[0])
        .to.emit(depositManager, "RewardTokenAdded")
        .withArgs(rewardParameters[0].bucket, rewardParameters[0].rewardTokens[1])
        .to.emit(depositManager, "RewardTokenAdded")
        .withArgs(rewardParameters[1].bucket, rewardParameters[1].rewardTokens[0])
        .to.emit(depositManager, "RewardTokenAdded")
        .withArgs(rewardParameters[1].bucket, rewardParameters[1].rewardTokens[1]);
    });

    it("Should correctly set interestRates and emit event InterestRateSet", async function () {
      await expect(depositManager.connect(SmallTimelockAdmin).setRewardParameters(rewardParameters))
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[0].bucket,
          rewardParameters[0].rewardTokens[0],
          rewardParameters[0].durations[0][0],
          rewardParameters[0].newInterestRates[0][0],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[0].bucket,
          rewardParameters[0].rewardTokens[0],
          rewardParameters[0].durations[0][1],
          rewardParameters[0].newInterestRates[0][1],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[0].bucket,
          rewardParameters[0].rewardTokens[1],
          rewardParameters[0].durations[1][0],
          rewardParameters[0].newInterestRates[1][0],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[0].bucket,
          rewardParameters[0].rewardTokens[1],
          rewardParameters[0].durations[1][1],
          rewardParameters[0].newInterestRates[1][1],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[1].bucket,
          rewardParameters[1].rewardTokens[0],
          rewardParameters[1].durations[0][0],
          rewardParameters[1].newInterestRates[0][0],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[1].bucket,
          rewardParameters[1].rewardTokens[0],
          rewardParameters[1].durations[0][1],
          rewardParameters[1].newInterestRates[0][1],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[1].bucket,
          rewardParameters[1].rewardTokens[1],
          rewardParameters[1].durations[1][0],
          rewardParameters[1].newInterestRates[1][0],
        )
        .to.emit(depositManager, "InterestRateSet")
        .withArgs(
          rewardParameters[1].bucket,
          rewardParameters[1].rewardTokens[1],
          rewardParameters[1].durations[1][1],
          rewardParameters[1].newInterestRates[1][1],
        );
    });

    it("Should correctly set maxTotalDeposits and emit event MaxTotalDepositSet", async function () {
      await expect(depositManager.connect(SmallTimelockAdmin).setRewardParameters(rewardParameters))
        .to.emit(depositManager, "MaxTotalDepositSet")
        .withArgs(rewardParameters[0].bucket, rewardParameters[0].maxTotalDeposit)
        .to.emit(depositManager, "MaxTotalDepositSet")
        .withArgs(rewardParameters[1].bucket, rewardParameters[1].maxTotalDeposit);
    });
  });

  describe("setTiersManager", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setRewardParameters", async function () {
      await expect(depositManager.connect(SmallTimelockAdmin).setTiersManager(mockTiersManager.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert deploy when the address not supported", async function () {
      await mockTiersManager.mock.supportsInterface.returns(false);
      await expect(depositManager.connect(BigTimelockAdmin).setTiersManager(mockTiersManager.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should allow only BIGL_TIMELOCK_ADMIN to setTiersManager", async function () {
      await mockTiersManager.mock.supportsInterface.returns(true);
      await depositManager.connect(BigTimelockAdmin).setTiersManager(mockTiersManager.address);
      expect(await depositManager.tierManager()).to.be.equal(mockTiersManager.address);
    });
  });
  describe("setMagicTierCoefficient", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setRewardParameters", async function () {
      await expect(depositManager.connect(SmallTimelockAdmin).setMagicTierCoefficient(parseEther("1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should allow only BIGL_TIMELOCK_ADMIN to setMagicTierCoefficient", async function () {
      expect(await depositManager.connect(BigTimelockAdmin).setMagicTierCoefficient(parseEther("1")));
    });
  });

  describe("getter functions", function () {
    before(async function () {
      await depositManager.connect(SmallTimelockAdmin).setRewardParameters(rewardParameters);
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

    it("should correctly return bucketPosibleDurations", async function () {
      let bucketDurations = await depositManager.getBucketPosibleDurations(rewardParameters[0].bucket, rewardParameters[0].rewardTokens[0]);
      let bucketDurationsAsNumbers = bucketDurations.map(duration => BigNumber.from(duration).toNumber());
      expect(bucketDurationsAsNumbers).to.deep.equal(rewardParameters[0].durations[0]);

      bucketDurations = await depositManager.getBucketPosibleDurations(rewardParameters[0].bucket, rewardParameters[0].rewardTokens[1]);
      bucketDurationsAsNumbers = bucketDurations.map(duration => BigNumber.from(duration).toNumber());
      expect(bucketDurationsAsNumbers).to.deep.equal(rewardParameters[0].durations[1]);

      bucketDurations = await depositManager.getBucketPosibleDurations(rewardParameters[1].bucket, rewardParameters[1].rewardTokens[0]);
      bucketDurationsAsNumbers = bucketDurations.map(duration => BigNumber.from(duration).toNumber());
      expect(bucketDurationsAsNumbers).to.deep.equal(rewardParameters[1].durations[0]);

      bucketDurations = await depositManager.getBucketPosibleDurations(rewardParameters[1].bucket, rewardParameters[1].rewardTokens[1]);
      bucketDurationsAsNumbers = bucketDurations.map(duration => BigNumber.from(duration).toNumber());
      expect(bucketDurationsAsNumbers).to.deep.equal(rewardParameters[1].durations[1]);
    });

    it("should correctly return bucketRewardTokens", async function () {
      let bucketRewardTokens = await depositManager.getBucketRewardTokens(rewardParameters[0].bucket);
      expect(bucketRewardTokens).to.deep.equal(rewardParameters[0].rewardTokens);

      bucketRewardTokens = await depositManager.getBucketRewardTokens(rewardParameters[1].bucket);
      expect(bucketRewardTokens).to.deep.equal(rewardParameters[1].rewardTokens);
    });
  });

  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(depositManager.connect(caller).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(depositManager.connect(caller).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
